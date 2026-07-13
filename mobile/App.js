import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  FlatList,
  ScrollView,
  Image,
  ActivityIndicator,
  SafeAreaView,
  StatusBar,
  Alert,
  Dimensions,
  Platform,
  Modal,
  BackHandler,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Camera, CameraView } from 'expo-camera';

import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import ImageViewer from 'react-native-image-zoom-viewer';


// ─── CONFIGURATION ──────────────────────────────────────────────────────────
// Raw links of your GitHub Repository files
const DATABASE_DATA_URL = 'https://raw.githubusercontent.com/muzzamil-nazir-jutt/scanerapp/main/equipment_data.json';
const DATABASE_IMAGES_URL = 'https://raw.githubusercontent.com/muzzamil-nazir-jutt/scanerapp/main/equipment_images.json';
const AUTO_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

const STORAGE_KEYS = {
  ASSETS: 'voltsync_assets',
  LAST_SYNC: 'voltsync_last_sync',
  IS_FIRST_LAUNCH: 'voltsync_is_first_launch',
  IMAGES_SYNCED: 'voltsync_images_synced',
};

export default function App() {
  const [activeTab, setActiveTab] = useState('scan'); // 'scan', 'manual', 'db'
  const [currentScreen, setCurrentScreen] = useState('Home'); // 'Home', 'Details'
  const [selectedAssetNumber, setSelectedAssetNumber] = useState(null);
  
  // Database States
  const [assets, setAssets] = useState([]);
  const [lastSynced, setLastSynced] = useState(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isFirstLaunch, setIsFirstLaunch] = useState(false);

  // Zoom and navigation history states
  const [zoomImage, setZoomImage] = useState(null);
  const [navStack, setNavStack] = useState([]);

  // Manual Screen Search State
  const [manualCode, setManualCode] = useState('');
  
  // Database Screen Search & Filter States
  const [dbSearchQuery, setDbSearchQuery] = useState('');
  const [dbStatusFilter, setDbStatusFilter] = useState('All');

  // Camera States
  const [hasCameraPermission, setHasCameraPermission] = useState(null);
  const [scanned, setScanned] = useState(false);

  // ─── Initial Load & Permissions ───────────────────────────────────────────
  useEffect(() => {
    const checkLaunchStatus = async () => {
      try {
        const localData = await AsyncStorage.getItem(STORAGE_KEYS.ASSETS);
        const parsedAssets = localData ? JSON.parse(localData) : [];
        setAssets(parsedAssets);

        const syncTime = await AsyncStorage.getItem(STORAGE_KEYS.LAST_SYNC);
        if (syncTime) {
          setLastSynced(new Date(syncTime).toLocaleString());
        }

        const firstLaunchFlag = await AsyncStorage.getItem(STORAGE_KEYS.IS_FIRST_LAUNCH);
        
        if (firstLaunchFlag === null && parsedAssets.length === 0) {
          setIsFirstLaunch(true);
          await triggerDataSync(true); 
        } else {
          setIsFirstLaunch(false);
          // Check for auto-update silently if 24 hours elapsed
          if (syncTime) {
            const lastSyncMs = new Date(syncTime).getTime();
            const nowMs = Date.now();
            if (nowMs - lastSyncMs > AUTO_SYNC_INTERVAL_MS) {
              triggerDataSync(false, true); // silent update
            }
          }
        }
      } catch (err) {
        console.error('Error loading local storage:', err);
      }
    };

    const requestCameraPermission = async () => {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasCameraPermission(status === 'granted');
    };

    checkLaunchStatus();
    requestCameraPermission();
  }, []);

  // BackHandler logic for Android
  useEffect(() => {
    const onBackPress = () => {
      if (zoomImage) {
        setZoomImage(null);
        return true;
      }
      if (currentScreen === 'Details') {
        handleDetailsBack();
        return true;
      }
      return false; // let system handle (close app)
    };

    const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => subscription.remove();
  }, [currentScreen, zoomImage, navStack]);

  const handleDetailsBack = () => {
    if (navStack.length > 0) {
      const prev = navStack[navStack.length - 1];
      setNavStack(stack => stack.slice(0, -1));
      setSelectedAssetNumber(prev);
    } else {
      setCurrentScreen('Home');
    }
  };

  // Request Camera Permission manually if denied
  const handleRequestCameraPermission = async () => {
    const { status } = await Camera.requestCameraPermissionsAsync();
    setHasCameraPermission(status === 'granted');
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'Please enable camera permissions in settings to scan QRs.');
    }
  };

  // ─── Sync Engine ───────────────────────────────────────────────────────────
  const mergeImagesIntoData = (dataAssets, imagesPayload) => {
    if (!imagesPayload || !imagesPayload.images) return dataAssets;

    const imageMap = {};
    for (const imgEntry of imagesPayload.images) {
      imageMap[imgEntry.asset_id] = {};
      for (const blk of imgEntry.blocks) {
        imageMap[imgEntry.asset_id][blk.id] = blk.base64;
      }
    }

    return dataAssets.map(asset => {
      const assetImages = imageMap[asset.id];
      if (!assetImages) return asset;

      const mergeBlocks = (blocks) => blocks.map(blk => {
        if (blk.type === 'image_ref' && assetImages[blk.id]) {
          return { ...blk, type: 'image', value: assetImages[blk.id] };
        }
        return blk;
      });

      return {
        ...asset,
        descriptionBlocks: mergeBlocks(asset.descriptionBlocks || []),
        instructionBlocks: mergeBlocks(asset.instructionBlocks || []),
      };
    });
  };

  const triggerDataSync = async (isInitial = false, isSilent = false) => {
    if (!isSilent) setIsSyncing(true);
    try {
      const response = await fetch(DATABASE_DATA_URL, {
        headers: { 'Cache-Control': 'no-cache' }, 
      });
      
      if (!response.ok) {
        throw new Error(`Server returned status ${response.status}`);
      }

      const payload = await response.json();
      const cleanPayload = Array.isArray(payload) ? payload : (payload.data || []);
      
      if (Array.isArray(cleanPayload)) {
        // Retrieve and merge existing images if present
        const storedImagesRaw = await AsyncStorage.getItem(STORAGE_KEYS.IMAGES_SYNCED);
        const storedImages = storedImagesRaw ? JSON.parse(storedImagesRaw) : null;
        const mergedData = mergeImagesIntoData(cleanPayload, storedImages);

        await AsyncStorage.setItem(STORAGE_KEYS.ASSETS, JSON.stringify(mergedData));
        
        const timestamp = new Date().toISOString();
        await AsyncStorage.setItem(STORAGE_KEYS.LAST_SYNC, timestamp);
        await AsyncStorage.setItem(STORAGE_KEYS.IS_FIRST_LAUNCH, 'false');

        setAssets(mergedData);
        setLastSynced(new Date(timestamp).toLocaleString());
        setIsFirstLaunch(false);

        if (!isInitial && !isSilent) {
          Alert.alert('Sync Complete', `Data updated! Total ${cleanPayload.length} assets downloaded.`);
        }
      } else {
        throw new Error('Invalid JSON format.');
      }
    } catch (err) {
      console.error('Sync failed:', err);
      if (!isSilent) {
        if (isInitial) {
          Alert.alert(
            'Offline Mode Active',
            'Could not download the initial database from GitHub. You can refresh later in the "Sync" tab.',
            [{ text: 'OK', onPress: () => setIsFirstLaunch(false) }]
          );
        } else {
          Alert.alert('Sync Failed', 'Could not fetch database from GitHub. Using cached offline data.');
        }
      }
    } finally {
      if (!isSilent) setIsSyncing(false);
    }
  };

  const triggerImageSync = async () => {
    setIsSyncing(true);
    try {
      const response = await fetch(DATABASE_IMAGES_URL, {
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (!response.ok) {
        throw new Error(`Server returned status ${response.status}`);
      }
      const imagesPayload = await response.json();

      if (imagesPayload && imagesPayload.images) {
        await AsyncStorage.setItem(STORAGE_KEYS.IMAGES_SYNCED, JSON.stringify(imagesPayload));

        // Merge with current data
        const storedDataRaw = await AsyncStorage.getItem(STORAGE_KEYS.ASSETS);
        const storedData = storedDataRaw ? JSON.parse(storedDataRaw) : [];
        const mergedData = mergeImagesIntoData(storedData, imagesPayload);

        await AsyncStorage.setItem(STORAGE_KEYS.ASSETS, JSON.stringify(mergedData));
        setAssets(mergedData);

        Alert.alert('Images Synced', 'All equipment images downloaded and merged successfully.');
      } else {
        throw new Error('Invalid Images JSON structure.');
      }
    } catch (err) {
      Alert.alert('Image Sync Failed', 'Could not sync images: ' + err.message);
    } finally {
      setIsSyncing(false);
    }
  };

  // ─── Handle Scanning ───────────────────────────────────────────────────────
  const handleBarCodeScanned = ({ data }) => {
    if (scanned) return;
    setScanned(true);
    
    const assetNumber = data.trim().toUpperCase();
    setSelectedAssetNumber(assetNumber);
    setCurrentScreen('Details');
    
    setTimeout(() => {
      setScanned(false);
    }, 1500);
  };

  // ─── Manual Code Search ────────────────────────────────────────────────────
  const handleManualSearch = () => {
    const codeToSearch = manualCode.trim().toUpperCase();
    if (!codeToSearch) {
      Alert.alert('Empty Input', 'Please enter a Tag / Asset Code.');
      return;
    }

    const found = assets.some(
      (a) => a.asset_number.toUpperCase() === codeToSearch
    );

    if (found) {
      setSelectedAssetNumber(codeToSearch);
      setCurrentScreen('Details');
    } else {
      Alert.alert('Not Found', `Asset Code "${codeToSearch}" was not found in the offline database.`);
    }
  };

  // ─── Filter Database List (Tab 3) ─────────────────────────────────────────
  const filteredAssets = assets.filter((item) => {
    const query = dbSearchQuery.toLowerCase();
    const matchesSearch =
      item.asset_number.toLowerCase().includes(query) ||
      item.name.toLowerCase().includes(query) ||
      item.model.toLowerCase().includes(query);

    const matchesStatus = dbStatusFilter === 'All' || item.status === dbStatusFilter;
    return matchesSearch && matchesStatus;
  });

  const renderFormattedText = (text) => {
    if (!text) return null;
    const parts = text.split(/(\*\*[^*]+\*\*|==[^=]+==)/g);
    return (
      <Text>
        {parts.map((part, i) => {
          if (part.startsWith('**') && part.endsWith('**')) {
            return (
              <Text key={i} style={{ fontWeight: "bold", color: "#ffffff" }} selectable={true}>
                {part.slice(2, -2)}
              </Text>
            );
          } else if (part.startsWith('==') && part.endsWith('==')) {
            return (
              <Text key={i} style={{ backgroundColor: "#fbbf24", color: "#000000", borderRadius: 2, paddingHorizontal: 2 }} selectable={true}>
                {part.slice(2, -2)}
              </Text>
            );
          }
          return <Text key={i} selectable={true}>{part}</Text>;
        })}
      </Text>
    );
  };

  // Render sequential blocks of text and images
  const renderBlockList = (blocks) => {
    if (!blocks || blocks.length === 0) return null;
    return blocks.map((block) => {
      if (block.type === 'text') {
        return (
          <Text key={block.id} style={styles.detailsBlockText} selectable={true}>
            {renderFormattedText(block.value)}
          </Text>
        );
      } else if ((block.type === 'image' || block.type === 'image_ref') && block.value) {
        return (
          <TouchableOpacity
            key={block.id}
            onPress={() => setZoomImage(block.value)}
            activeOpacity={0.85}
          >
            <Image
              source={{ uri: `data:image/jpeg;base64,${block.value}` }}
              style={styles.detailsBlockImage}
            />
            <Text style={styles.tapToZoomHint}>👆 Tap to zoom</Text>
          </TouchableOpacity>
        );
      }
      return null;
    });
  };

  // Setup/Sync overlay on first launch
  if (isFirstLaunch && isSyncing) {
    return (
      <View style={styles.loadingOverlay}>
        <StatusBar barStyle="light-content" backgroundColor="#05081a" />
        <ActivityIndicator size="large" color="#22d3ee" />
        <Text style={styles.loadingTitle}>VoltSync Setup</Text>
        <Text style={styles.loadingText}>Downloading asset database from Cloud...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#05081a" />

      {/* SCREEN ROUTING */}
      {currentScreen === 'Details' ? (
        // DETAILS SCREEN OVERLAY
        (() => {
          const asset = assets.find((a) => a.asset_number.toUpperCase() === selectedAssetNumber?.toUpperCase());
          
          // Get the main background picture if available (first image block or legacy image)
          const mainImageBase64 = 
            asset?.descriptionBlocks?.find(b => b.type === 'image')?.value || 
            asset?.instructionBlocks?.find(b => b.type === 'image')?.value || 
            asset?.image;

          return (
            <View style={styles.detailsScreenContainer}>
              <View style={styles.detailsHeader}>
                <TouchableOpacity style={styles.backButton} onPress={handleDetailsBack}>
                  <Text style={styles.backButtonText}>
                    {navStack.length > 0 ? '← Back' : '← Close'}
                  </Text>
                </TouchableOpacity>
                <Text style={styles.detailsHeaderTitle}>Equipment Details</Text>
                <View style={{ width: 60 }} />
              </View>

              {asset ? (
                <ScrollView contentContainerStyle={styles.detailsContent} showsVerticalScrollIndicator={false}>
                  <View style={styles.detailsCard}>
                    {mainImageBase64 ? (
                      <TouchableOpacity onPress={() => setZoomImage(mainImageBase64)} activeOpacity={0.9}>
                        <Image
                          source={{ uri: `data:image/jpeg;base64,${mainImageBase64}` }}
                          style={styles.detailsImage}
                        />
                        <Text style={styles.tapToZoomHint}>👆 Tap to zoom</Text>
                      </TouchableOpacity>
                    ) : (
                      <View style={styles.noImagePlaceholder}>
                        <Text style={styles.noImageText}>No Image Attached</Text>
                      </View>
                    )}

                    <View style={styles.detailsCardContent}>
                      <View style={styles.detailsRowHeader}>
                        <Text style={styles.detailsAssetCode} selectable={true}>Asset #{asset.asset_number}</Text>
                        <View style={[
                          styles.badge,
                          asset.status === 'Working' && styles.badgeWorking,
                          asset.status === 'Maintenance' && styles.badgeMaintenance,
                          asset.status === 'Faulty' && styles.badgeFaulty,
                        ]}>
                          <Text style={[
                            styles.badgeText,
                            asset.status === 'Working' && styles.badgeTextWorking,
                            asset.status === 'Maintenance' && styles.badgeTextMaintenance,
                            asset.status === 'Faulty' && styles.badgeTextFaulty,
                          ]}>{asset.status}</Text>
                        </View>
                      </View>

                      {asset.title ? (
                        <Text style={styles.detailsTitle}>{asset.title}</Text>
                      ) : null}
                      <Text style={styles.detailsName} selectable={true}>{asset.name}</Text>
                      
                      <View style={styles.detailSection}>
                        <Text style={styles.sectionLabel}>Model / Specification</Text>
                        <Text style={styles.sectionValue} selectable={true}>{asset.model}</Text>
                      </View>

                      {/* Display Description and Specs Blocks (or fallback to legacy specs/background/image) */}
                      <View style={styles.detailSection}>
                        <Text style={styles.sectionLabel}>Technical Specs & Background</Text>
                        {(asset.descriptionBlocks && asset.descriptionBlocks.length > 0) ? (
                          renderBlockList(asset.descriptionBlocks)
                        ) : (
                          // Fallbacks for older data structures
                          <View>
                            {asset.specs ? <Text style={styles.detailsBlockText} selectable={true}>{asset.specs}</Text> : null}
                            {asset.background ? <Text style={styles.detailsBlockText} selectable={true}>{asset.background}</Text> : null}
                          </View>
                        )}
                      </View>

                      {/* Display Installation Blocks (or fallback to legacy instructions) */}
                      {((asset.instructionBlocks && asset.instructionBlocks.length > 0) || asset.instructions) ? (
                        <View style={styles.detailSection}>
                          <Text style={styles.sectionLabel}>Installation Instructions</Text>
                          <View style={styles.descriptionBox}>
                            {(asset.instructionBlocks && asset.instructionBlocks.length > 0) ? (
                              renderBlockList(asset.instructionBlocks)
                            ) : (
                              <Text style={styles.descriptionText} selectable={true}>{asset.instructions}</Text>
                            )}
                          </View>
                        </View>
                      ) : null}

                      {/* Display Linked Assets */}
                      {asset.linkedAssets && asset.linkedAssets.length > 0 && (
                        <View style={styles.detailSection}>
                          <Text style={styles.sectionLabel}>🔗 Related / Linked Parts</Text>
                          {asset.linkedAssets.map((link, i) => {
                            const linkedAsset = assets.find(
                              a => a.asset_number.trim().toUpperCase() === link.asset_number.trim().toUpperCase()
                            );
                            return (
                              <TouchableOpacity
                                key={i}
                                style={styles.linkedCard}
                                onPress={() => {
                                  if (linkedAsset) {
                                    setNavStack(prev => [...prev, selectedAssetNumber]);
                                    setSelectedAssetNumber(link.asset_number);
                                  } else {
                                    Alert.alert('Not Synced', `Asset #${link.asset_number} is not in the local database. Please sync.`);
                                  }
                                }}
                              >
                                <View style={{ flex: 1 }}>
                                  <Text style={styles.linkedCardLabel}>{link.label || 'Related Asset'}</Text>
                                  <Text style={styles.linkedCardName}>{linkedAsset ? linkedAsset.name : 'Unknown Equipment'}</Text>
                                  <Text style={styles.linkedCardTag}>Asset #{link.asset_number}</Text>
                                </View>
                                <Text style={{ color: '#22d3ee', fontSize: 20 }}>→</Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      )}
                    </View>
                  </View>
                </ScrollView>
              ) : (
                <View style={styles.errorContainer}>
                  <Text style={styles.errorTitle}>Asset Not Found</Text>
                  <Text style={styles.errorText}>
                    Code "{selectedAssetNumber}" is not registered in the offline database.
                  </Text>
                  <TouchableOpacity style={styles.errorButton} onPress={handleDetailsBack}>
                    <Text style={styles.errorButtonText}>Go Back</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          );
        })()
      ) : (
        // HOME SCREEN WITH TABS
        <View style={{ flex: 1 }}>
          {/* TAB CONTENT */}
          
          {/* TAB 1: SCAN QR (DIRECT CAMERA READ) */}
          {activeTab === 'scan' && (
            <View style={styles.tabContentContainer}>
              {hasCameraPermission === null ? (
                <View style={styles.centerContainer}>
                  <ActivityIndicator size="large" color="#22d3ee" />
                  <Text style={styles.infoText}>Requesting Camera Access...</Text>
                </View>
              ) : hasCameraPermission === false ? (
                <View style={styles.centerContainer}>
                  <Text style={styles.errorText}>Camera permission was denied.</Text>
                  <TouchableOpacity style={styles.primaryButton} onPress={handleRequestCameraPermission}>
                    <Text style={styles.primaryButtonText}>Enable Camera</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.scannerWrapper}>
                  <CameraView
                    style={StyleSheet.absoluteFillObject}
                    onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
                    barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                  />
                  <View style={styles.overlay}>
                    <View style={styles.unfocusedContainer}>
                      <Text style={styles.scanHeaderTitle}>⚡ VOLTSYNC SCANNER</Text>
                    </View>
                    <View style={styles.middleContainer}>
                      <View style={styles.unfocusedContainer}></View>
                      <View style={styles.focusedContainer}>
                        <View style={styles.scanTargetCornerTL}></View>
                        <View style={styles.scanTargetCornerTR}></View>
                        <View style={styles.scanTargetCornerBL}></View>
                        <View style={styles.scanTargetCornerBR}></View>
                      </View>
                      <View style={styles.unfocusedContainer}></View>
                    </View>
                    <View style={styles.unfocusedContainer}>
                      <Text style={styles.scanInstructions}>Align QR code inside frame to read data</Text>
                    </View>
                  </View>
                </View>
              )}
            </View>
          )}

          {/* TAB 2: MANUAL SEARCH */}
          {activeTab === 'manual' && (
            <View style={[styles.tabContentContainer, { paddingHorizontal: 20, paddingTop: 40 }]}>
              <Text style={styles.sectionHeaderTitle}>⌨️ Enter Tag Number</Text>
              <Text style={styles.sectionSubtitle}>Enter the Asset/Tag ID manually to get equipment data offline</Text>
              
              <View style={styles.manualForm}>
                <TextInput
                  style={styles.manualInput}
                  placeholder="e.g. 1, 2, PP-GEN-003..."
                  placeholderTextColor="#64748b"
                  value={manualCode}
                  onChangeText={setManualCode}
                  autoCapitalize="characters"
                  returnKeyType="search"
                  onSubmitEditing={handleManualSearch}
                />
                
                <TouchableOpacity style={styles.primaryButton} onPress={handleManualSearch}>
                  <Text style={styles.primaryButtonText}>Retrieve Equipment Details</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.infoCard}>
                <Text style={styles.infoCardText}>
                  💡 Note: Make sure the database is synchronized in the Database Tab to fetch the latest entries.
                </Text>
              </View>
            </View>
          )}

          {/* TAB 3: DATABASE & SYNC */}
          {activeTab === 'db' && (
            <View style={[styles.tabContentContainer, { paddingHorizontal: 16, paddingTop: 20 }]}>
              <Text style={styles.sectionHeaderTitle}>📦 Offline Database</Text>
              
              {/* Sync Status Card */}
              <View style={styles.syncCard}>
                <View style={styles.syncCardLeft}>
                  <Text style={styles.syncCardLabel}>Status</Text>
                  <Text style={styles.syncCardValue}>{assets.length} Assets Registered</Text>
                  <Text style={styles.syncCardTimestamp}>Last Sync: {lastSynced || 'Never'}</Text>
                </View>
                <View style={{ gap: 8 }}>
                  <TouchableOpacity 
                    style={styles.syncButton} 
                    onPress={() => triggerDataSync(false)}
                    disabled={isSyncing}
                  >
                    {isSyncing ? (
                      <ActivityIndicator size="small" color="#22d3ee" />
                    ) : (
                      <Text style={styles.syncButtonText}>📊 Sync Data</Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.syncButton, { borderColor: 'rgba(251,191,36,0.3)' }]} 
                    onPress={triggerImageSync}
                    disabled={isSyncing}
                  >
                    {isSyncing ? (
                      <ActivityIndicator size="small" color="#fbbf24" />
                    ) : (
                      <Text style={[styles.syncButtonText, { color: '#fbbf24' }]}>🖼️ Sync Images</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>

              {/* Local List Search */}
              <TextInput
                style={styles.dbSearchInput}
                placeholder="Search local records by name, model, number..."
                placeholderTextColor="#64748b"
                value={dbSearchQuery}
                onChangeText={setDbSearchQuery}
              />

              {/* Status Filter tabs */}
              <View style={styles.dbFilterRow}>
                {['All', 'Working', 'Maintenance', 'Faulty'].map((status) => (
                  <TouchableOpacity
                    key={status}
                    style={[
                      styles.dbFilterButton,
                      dbStatusFilter === status && styles.dbFilterButtonActive
                    ]}
                    onPress={() => setDbStatusFilter(status)}
                  >
                    <Text style={[
                      styles.dbFilterButtonText,
                      dbStatusFilter === status && styles.dbFilterButtonTextActive
                    ]}>{status}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Items List */}
              <FlatList
                data={filteredAssets}
                keyExtractor={(item) => item.id.toString()}
                contentContainerStyle={{ paddingBottom: 80 }}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.assetListItem}
                    onPress={() => {
                      setSelectedAssetNumber(item.asset_number);
                      setCurrentScreen('Details');
                    }}
                  >
                    <View style={styles.assetListHeader}>
                      <Text style={styles.assetListName}>{item.name}</Text>
                      <View style={[
                        styles.badge,
                        item.status === 'Working' && styles.badgeWorking,
                        item.status === 'Maintenance' && styles.badgeMaintenance,
                        item.status === 'Faulty' && styles.badgeFaulty,
                      ]}>
                        <Text style={[
                          styles.badgeText,
                          item.status === 'Working' && styles.badgeTextWorking,
                          item.status === 'Maintenance' && styles.badgeTextMaintenance,
                          item.status === 'Faulty' && styles.badgeTextFaulty,
                        ]}>{item.status}</Text>
                      </View>
                    </View>
                    <Text style={styles.assetListCode}>Tag: {item.asset_number}</Text>
                    <Text style={styles.assetListModel}>Model: {item.model}</Text>
                  </TouchableOpacity>
                )}
                ListEmptyComponent={
                  <View style={styles.emptyContainer}>
                    <Text style={styles.emptyText}>No registered assets found.</Text>
                    <Text style={styles.emptySubtext}>Perform Sync Cloud above to get data.</Text>
                  </View>
                }
              />
            </View>
          )}

          {/* CUSTOM BOTTOM TAB BAR */}
          <View style={styles.tabBar}>
            <TouchableOpacity 
              style={[styles.tabItem, activeTab === 'scan' && styles.tabItemActive]}
              onPress={() => setActiveTab('scan')}
            >
              <Text style={styles.tabIcon}>📷</Text>
              <Text style={[styles.tabLabel, activeTab === 'scan' && styles.tabLabelActive]}>Scan QR</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.tabItem, activeTab === 'manual' && styles.tabItemActive]}
              onPress={() => setActiveTab('manual')}
            >
              <Text style={styles.tabIcon}>⌨️</Text>
              <Text style={[styles.tabLabel, activeTab === 'manual' && styles.tabLabelActive]}>Enter Code</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.tabItem, activeTab === 'db' && styles.tabItemActive]}
              onPress={() => setActiveTab('db')}
            >
              <Text style={styles.tabIcon}>📦</Text>
              <Text style={[styles.tabLabel, activeTab === 'db' && styles.tabLabelActive]}>Sync & DB</Text>
            </TouchableOpacity>
          </View>

        </View>
      )}

      {/* FULL SCREEN ZOOM MODAL */}
      <Modal
        visible={zoomImage !== null}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setZoomImage(null)}
      >
        <ImageViewer
          imageUrls={zoomImage ? [{ url: `data:image/jpeg;base64,${zoomImage}` }] : []}
          enableSwipeDown={true}
          onSwipeDown={() => setZoomImage(null)}
          renderIndicator={() => null}
          renderHeader={() => (
            <View style={{ position: 'absolute', top: 50, left: 0, right: 0, zIndex: 999, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20 }}>
              <TouchableOpacity
                style={{ backgroundColor: 'rgba(0,0,0,0.6)', padding: 10, borderRadius: 8 }}
                onPress={async () => {
                  if (!zoomImage) return;
                  try {
                    const { status } = await MediaLibrary.requestPermissionsAsync();
                    if (status !== 'granted') {
                      Alert.alert('Permission Denied', 'Storage permission is required to save images.');
                      return;
                    }
                    const fileUri = FileSystem.documentDirectory + `voltsync_${Date.now()}.jpg`;
                    await FileSystem.writeAsStringAsync(fileUri, zoomImage, { encoding: FileSystem.EncodingType.Base64 });
                    const asset = await MediaLibrary.createAssetAsync(fileUri);
                    await MediaLibrary.createAlbumAsync('VoltSync', asset, false);
                    Alert.alert('Success', 'Image saved to gallery!');
                  } catch (err) {
                    Alert.alert('Error', 'Failed to save image.');
                  }
                }}
              >
                <Text style={{ color: 'white', fontSize: 16, fontWeight: 'bold' }}>📥 Download</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ backgroundColor: 'rgba(0,0,0,0.6)', padding: 10, borderRadius: 8 }}
                onPress={() => setZoomImage(null)}
              >
                <Text style={{ color: 'white', fontSize: 16, fontWeight: 'bold' }}>✕ Close</Text>
              </TouchableOpacity>
            </View>
          )}
        />
      </Modal>
    </SafeAreaView>
  );
}

const { width } = Dimensions.get('window');
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#05081a' },
  loadingOverlay: { flex: 1, backgroundColor: '#05081a', alignItems: 'center', justifyContent: 'center', padding: 24 },
  loadingTitle: { fontSize: 22, fontWeight: 'bold', color: '#ffffff', marginTop: 20 },
  loadingText: { fontSize: 14, color: '#94a3b8', textAlign: 'center', marginTop: 8 },
  
  // Tab Routing Styling
  tabContentContainer: { flex: 1 },
  centerContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  infoText: { color: '#94a3b8', marginTop: 14, fontSize: 14 },
  
  // Custom Tab Bar
  tabBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 64,
    backgroundColor: '#0a0f26',
    borderTopWidth: 1.5,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingBottom: Platform.OS === 'ios' ? 10 : 0,
  },
  tabItem: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    height: '100%',
  },
  tabItemActive: {
    borderTopWidth: 2,
    borderTopColor: '#22d3ee',
  },
  tabIcon: {
    fontSize: 20,
    marginBottom: 2,
  },
  tabLabel: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '700',
  },
  tabLabelActive: {
    color: '#22d3ee',
  },

  // Tab 1: Scan QR Screen
  scannerWrapper: { flex: 1 },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  unfocusedContainer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', alignItems: 'center' },
  scanHeaderTitle: { color: '#22d3ee', fontWeight: 'bold', fontSize: 18, tracking: 1, marginTop: 10 },
  middleContainer: { flexDirection: 'row', height: width * 0.72 },
  focusedContainer: { width: width * 0.72, height: width * 0.72, position: 'relative' },
  scanTargetCornerTL: { position: 'absolute', top: 0, left: 0, width: 34, height: 34, borderTopWidth: 4, borderLeftWidth: 4, borderColor: '#22d3ee', borderTopLeftRadius: 8 },
  scanTargetCornerTR: { position: 'absolute', top: 0, right: 0, width: 34, height: 34, borderTopWidth: 4, borderRightWidth: 4, borderColor: '#22d3ee', borderTopRightRadius: 8 },
  scanTargetCornerBL: { position: 'absolute', bottom: 0, left: 0, width: 34, height: 34, borderBottomWidth: 4, borderLeftWidth: 4, borderColor: '#22d3ee', borderBottomLeftRadius: 8 },
  scanTargetCornerBR: { position: 'absolute', bottom: 0, right: 0, width: 34, height: 34, borderBottomWidth: 4, borderRightWidth: 4, borderColor: '#22d3ee', borderBottomRightRadius: 8 },
  scanInstructions: { color: '#ffffff', fontSize: 13, fontWeight: '600', textAlign: 'center', paddingHorizontal: 20 },

  // Tab 2: Manual Search Screen
  sectionHeaderTitle: { fontSize: 20, fontWeight: 'bold', color: '#ffffff', marginBottom: 4 },
  sectionSubtitle: { fontSize: 13, color: '#64748b', lineHeight: 18, marginBottom: 24 },
  manualForm: { width: '100%', marginBottom: 24 },
  manualInput: { backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.12)', borderRadius: 10, paddingVertical: 14, paddingHorizontal: 16, color: '#e2e8f0', fontSize: 16, marginBottom: 16, textAlign: 'center', fontWeight: 'bold', tracking: 1 },
  primaryButton: { backgroundColor: '#22d3ee', paddingVertical: 14, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  primaryButtonText: { color: '#05081a', fontWeight: 'bold', fontSize: 15 },
  infoCard: { backgroundColor: 'rgba(34,211,238,0.05)', borderWidth: 1, borderColor: 'rgba(34,211,238,0.15)', borderRadius: 10, padding: 14 },
  infoCardText: { color: '#22d3ee', fontSize: 12, lineHeight: 18 },

  // Tab 3: Database & Sync Screen
  syncCard: { backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: 12, padding: 16, marginVertical: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  syncCardLeft: { flex: 1 },
  syncCardLabel: { fontSize: 11, fontWeight: '700', color: '#64748b', textTransform: 'uppercase' },
  syncCardValue: { fontSize: 16, fontWeight: 'bold', color: '#ffffff', marginVertical: 2 },
  syncCardTimestamp: { fontSize: 11, color: '#94a3b8' },
  syncButton: { backgroundColor: 'rgba(34,211,238,0.1)', borderWidth: 1, borderColor: 'rgba(34,211,238,0.2)', paddingVertical: 10, paddingHorizontal: 18, borderRadius: 8, alignItems: 'center', justifyContent: 'center', minWidth: 90 },
  syncButtonText: { color: '#22d3ee', fontWeight: 'bold', fontSize: 13 },
  dbSearchInput: { backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 14, color: '#e2e8f0', fontSize: 13, marginBottom: 12 },
  dbFilterRow: { flexDirection: 'row', marginBottom: 14 },
  dbFilterButton: { flex: 1, paddingVertical: 8, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.02)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.04)', marginHorizontal: 2, borderRadius: 6 },
  dbFilterButtonActive: { backgroundColor: 'rgba(34,211,238,0.1)', borderColor: 'rgba(34,211,238,0.3)' },
  dbFilterButtonText: { fontSize: 11, color: '#94a3b8', fontWeight: '600' },
  dbFilterButtonTextActive: { color: '#22d3ee' },
  
  assetListItem: { backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', borderRadius: 8, padding: 12, marginBottom: 10 },
  assetListHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  assetListName: { fontSize: 14, fontWeight: 'bold', color: '#ffffff', flex: 1, marginRight: 8 },
  assetListCode: { fontFamily: 'monospace', fontSize: 11, color: '#22d3ee', fontWeight: '600', marginBottom: 2 },
  assetListModel: { fontSize: 11, color: '#64748b' },

  // Details Overlay Screen
  detailsScreenContainer: { flex: 1, backgroundColor: '#05081a', paddingHorizontal: 16 },
  detailsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)' },
  backButton: { paddingVertical: 6, paddingHorizontal: 12, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 6 },
  backButtonText: { color: '#e2e8f0', fontWeight: '700', fontSize: 13 },
  detailsHeaderTitle: { fontSize: 18, fontWeight: 'bold', color: '#ffffff' },
  detailsContent: { paddingVertical: 16 },
  detailsCard: { backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: 12, overflow: 'hidden' },
  detailsImage: { width: '100%', height: 220, resizeMode: 'cover' },
  noImagePlaceholder: { width: '100%', height: 180, backgroundColor: 'rgba(255,255,255,0.02)', alignItems: 'center', justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  noImageText: { color: '#64748b', fontSize: 13, fontWeight: '600' },
  detailsCardContent: { padding: 18 },
  detailsRowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  detailsAssetCode: { fontFamily: 'monospace', fontSize: 20, fontWeight: '700', color: '#22d3ee' },
  detailsName: { fontSize: 24, fontWeight: 'bold', color: '#ffffff', marginBottom: 16 },
  detailSection: { marginBottom: 16 },
  sectionLabel: { fontSize: 12, fontWeight: '700', color: '#64748b', textTransform: 'uppercase', marginBottom: 6 },
  sectionValue: { fontSize: 16, color: '#f8fafc', lineHeight: 24 },
  descriptionBox: { backgroundColor: 'rgba(255,255,255,0.02)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: 12, marginTop: 4 },
  descriptionText: { fontSize: 16, color: '#f8fafc', lineHeight: 24 },

  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 99, borderWidth: 1 },
  badgeWorking: { backgroundColor: 'rgba(16, 185, 129, 0.1)', borderColor: 'rgba(16, 185, 129, 0.25)' },
  badgeMaintenance: { backgroundColor: 'rgba(245, 158, 11, 0.1)', borderColor: 'rgba(245, 158, 11, 0.25)' },
  badgeFaulty: { backgroundColor: 'rgba(239, 68, 68, 0.1)', borderColor: 'rgba(239, 68, 68, 0.25)' },
  badgeText: { fontSize: 9, fontWeight: '700' },
  badgeTextWorking: { color: '#34d399' },
  badgeTextMaintenance: { color: '#fbbf24' },
  badgeTextFaulty: { color: '#f87171' },

  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 34 },
  emptyText: { color: '#94a3b8', fontSize: 14, fontWeight: '600' },
  emptySubtext: { color: '#64748b', fontSize: 11, marginTop: 4 },

  errorContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 80 },
  errorTitle: { fontSize: 18, fontWeight: 'bold', color: '#f87171', marginBottom: 8 },
  errorText: { fontSize: 13, color: '#94a3b8', textAlign: 'center', paddingHorizontal: 24, marginBottom: 24, lineHeight: 18 },
  errorButton: { backgroundColor: 'rgba(255,255,255,0.1)', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8 },
  errorButtonText: { color: '#ffffff', fontWeight: '600', fontSize: 13 },

  // Block rendering inside Scanner Details Screen
  detailsBlockText: {
    color: '#f8fafc',
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 8,
  },
  detailsBlockImage: {
    width: '100%',
    height: 200,
    borderRadius: 8,
    resizeMode: 'cover',
    marginVertical: 10,
  },
  detailsTitle: {
    fontSize: 14,
    color: '#22d3ee',
    fontWeight: 'bold',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  linkedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(34,211,238,0.05)',
    borderWidth: 1.5,
    borderColor: 'rgba(34,211,238,0.15)',
    borderRadius: 10,
    padding: 12,
    marginTop: 8,
  },
  linkedCardLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#22d3ee',
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  linkedCardName: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  linkedCardTag: {
    fontSize: 11,
    fontFamily: 'monospace',
    color: '#64748b',
    marginTop: 2,
  },
  zoomModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  zoomCloseBtn: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 40,
    right: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    zIndex: 10,
  },
  zoomCloseBtnText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 13,
  },
  zoomFullImage: {
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height * 0.75,
  },
  tapToZoomHint: {
    fontSize: 10,
    color: '#64748b',
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 12,
  },
});
