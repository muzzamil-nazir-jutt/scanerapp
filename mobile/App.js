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
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Camera, CameraView } from 'expo-camera';

// ─── CONFIGURATION ──────────────────────────────────────────────────────────
// Raw link of your GitHub Repository
const DATABASE_JSON_URL = 'https://raw.githubusercontent.com/muzzamil-nazir-jutt/scanerapp/main/equipment.json'; 

const STORAGE_KEYS = {
  ASSETS: 'voltsync_assets',
  LAST_SYNC: 'voltsync_last_sync',
  IS_FIRST_LAUNCH: 'voltsync_is_first_launch',
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
        setLastSynced(syncTime);

        const firstLaunchFlag = await AsyncStorage.getItem(STORAGE_KEYS.IS_FIRST_LAUNCH);
        
        if (firstLaunchFlag === null && parsedAssets.length === 0) {
          setIsFirstLaunch(true);
          await triggerSync(true); 
        } else {
          setIsFirstLaunch(false);
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

  // Request Camera Permission manually if denied
  const handleRequestCameraPermission = async () => {
    const { status } = await Camera.requestCameraPermissionsAsync();
    setHasCameraPermission(status === 'granted');
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'Please enable camera permissions in settings to scan QRs.');
    }
  };

  // ─── Sync Engine ───────────────────────────────────────────────────────────
  const triggerSync = async (isInitial = false) => {
    setIsSyncing(true);
    try {
      const response = await fetch(DATABASE_JSON_URL, {
        headers: { 'Cache-Control': 'no-cache' }, 
      });
      
      if (!response.ok) {
        throw new Error(`Server returned status ${response.status}`);
      }

      const payload = await response.json();
      const cleanPayload = Array.isArray(payload) ? payload : (payload.data || []);
      
      if (Array.isArray(cleanPayload)) {
        await AsyncStorage.setItem(STORAGE_KEYS.ASSETS, JSON.stringify(cleanPayload));
        
        const timestamp = new Date().toLocaleString();
        await AsyncStorage.setItem(STORAGE_KEYS.LAST_SYNC, timestamp);
        await AsyncStorage.setItem(STORAGE_KEYS.IS_FIRST_LAUNCH, 'false');

        setAssets(cleanPayload);
        setLastSynced(timestamp);
        setIsFirstLaunch(false);

        if (!isInitial) {
          Alert.alert('Sync Complete', `Database updated! Total ${cleanPayload.length} assets downloaded.`);
        }
      } else {
        throw new Error('Invalid JSON format.');
      }
    } catch (err) {
      console.error('Sync failed:', err);
      if (isInitial) {
        Alert.alert(
          'Offline Mode Active',
          'Could not download the initial database from GitHub. You can refresh later in the "Sync" tab.',
          [{ text: 'OK', onPress: () => setIsFirstLaunch(false) }]
        );
      } else {
        Alert.alert('Sync Failed', 'Could not fetch database from GitHub. Using cached offline data.');
      }
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
          return (
            <View style={styles.detailsScreenContainer}>
              <View style={styles.detailsHeader}>
                <TouchableOpacity style={styles.backButton} onPress={() => setCurrentScreen('Home')}>
                  <Text style={styles.backButtonText}>← Close</Text>
                </TouchableOpacity>
                <Text style={styles.detailsHeaderTitle}>Equipment details</Text>
                <View style={{ width: 60 }} />
              </View>

              {asset ? (
                <ScrollView contentContainerStyle={styles.detailsContent} showsVerticalScrollIndicator={false}>
                  <View style={styles.detailsCard}>
                    {asset.image ? (
                      <Image
                        source={{ uri: `data:image/jpeg;base64,${asset.image}` }}
                        style={styles.detailsImage}
                      />
                    ) : (
                      <View style={styles.noImagePlaceholder}>
                        <Text style={styles.noImageText}>No Image Attached</Text>
                      </View>
                    )}

                    <View style={styles.detailsCardContent}>
                      <View style={styles.detailsRowHeader}>
                        <Text style={styles.detailsAssetCode}>Asset #{asset.asset_number}</Text>
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

                      <Text style={styles.detailsName}>{asset.name}</Text>
                      
                      <View style={styles.detailSection}>
                        <Text style={styles.sectionLabel}>Model / Specification</Text>
                        <Text style={styles.sectionValue}>{asset.model}</Text>
                      </View>

                      <View style={styles.detailSection}>
                        <Text style={styles.sectionLabel}>Technical Specs</Text>
                        <Text style={styles.sectionValue}>{asset.specs || '—'}</Text>
                      </View>

                      {asset.background ? (
                        <View style={styles.detailSection}>
                          <Text style={styles.sectionLabel}>History / Procurement</Text>
                          <Text style={styles.sectionValue}>{asset.background}</Text>
                        </View>
                      ) : null}

                      {asset.instructions ? (
                        <View style={styles.detailSection}>
                          <Text style={styles.sectionLabel}>Installation Instructions</Text>
                          <View style={styles.descriptionBox}>
                            <Text style={styles.descriptionText}>{asset.instructions}</Text>
                          </View>
                        </View>
                      ) : null}
                    </View>
                  </View>
                </ScrollView>
              ) : (
                <View style={styles.errorContainer}>
                  <Text style={styles.errorTitle}>Asset Not Found</Text>
                  <Text style={styles.errorText}>
                    Code "{selectedAssetNumber}" is not registered in the offline database.
                  </Text>
                  <TouchableOpacity style={styles.errorButton} onPress={() => setCurrentScreen('Home')}>
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
                <TouchableOpacity 
                  style={styles.syncButton} 
                  onPress={() => triggerSync(false)}
                  disabled={isSyncing}
                >
                  {isSyncing ? (
                    <ActivityIndicator size="small" color="#22d3ee" />
                  ) : (
                    <Text style={styles.syncButtonText}>Sync Cloud</Text>
                  )}
                </TouchableOpacity>
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
  detailsAssetCode: { fontFamily: 'monospace', fontSize: 16, fontWeight: '700', color: '#22d3ee' },
  detailsName: { fontSize: 18, fontWeight: 'bold', color: '#ffffff', marginBottom: 16 },
  detailSection: { marginBottom: 16 },
  sectionLabel: { fontSize: 10, fontWeight: '700', color: '#64748b', textTransform: 'uppercase', marginBottom: 4 },
  sectionValue: { fontSize: 13, color: '#cbd5e1', lineHeight: 18 },
  descriptionBox: { backgroundColor: 'rgba(255,255,255,0.02)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: 12, marginTop: 4 },
  descriptionText: { fontSize: 13, color: '#cbd5e1', lineHeight: 18 },

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
});
