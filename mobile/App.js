// App.js
import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  SafeAreaView,
  StatusBar,
  Alert,
  Dimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Camera, CameraView } from 'expo-camera';

// ─── CONFIGURATION ──────────────────────────────────────────────────────────
// Aap ki GitHub Repository ka RAW JSON link
const DATABASE_JSON_URL = 'https://raw.githubusercontent.com/muzzamil-nazir-jutt/database/main/equipment.json'; 

const STORAGE_KEYS = {
  ASSETS: 'voltsync_assets',
  LAST_SYNC: 'voltsync_last_sync',
  IS_FIRST_LAUNCH: 'voltsync_is_first_launch',
};

export default function App() {
  const [currentScreen, setCurrentScreen] = useState('Home');
  const [selectedAssetNumber, setSelectedAssetNumber] = useState(null);
  const [assets, setAssets] = useState([]);
  const [lastSynced, setLastSynced] = useState(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isFirstLaunch, setIsFirstLaunch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [hasCameraPermission, setHasCameraPermission] = useState(null);
  const [scanned, setScanned] = useState(false);

  // ─── Initial Load ──────────────────────────────────────────────────────────
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

    checkLaunchStatus();
  }, []);

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
          'Could not download the initial database from GitHub. You can refresh later when online.',
          [{ text: 'OK', onPress: () => setIsFirstLaunch(false) }]
        );
      } else {
        Alert.alert('Sync Failed', 'Could not fetch database from online URL. Using offline cached data.');
      }
    } finally {
      setIsSyncing(false);
    }
  };

  const navigateToScanner = async () => {
    if (hasCameraPermission === null || !hasCameraPermission) {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasCameraPermission(status === 'granted');
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Please enable camera permissions in settings to scan.');
        return;
      }
    }
    setCurrentScreen('Scanner');
  };

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

  const filteredAssets = assets.filter((item) => {
    const query = searchQuery.toLowerCase();
    const matchesSearch =
      item.asset_number.toLowerCase().includes(query) ||
      item.name.toLowerCase().includes(query) ||
      item.model.toLowerCase().includes(query);

    const matchesStatus = statusFilter === 'All' || item.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  if (isFirstLaunch && isSyncing) {
    return (
      <View style={styles.loadingOverlay}>
        <StatusBar barStyle="light-content" backgroundColor="#05081a" />
        <ActivityIndicator size="large" color="#22d3ee" />
        <Text style={styles.loadingTitle}>VoltSync Setup</Text>
        <Text style={styles.loadingText}>Downloading local asset database from Cloud...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#05081a" />

      {/* HOME SCREEN */}
      {currentScreen === 'Home' && (
        <View style={styles.screenContainer}>
          <View style={styles.header}>
            <View>
              <Text style={styles.headerTitle}>VoltSync Mobile</Text>
              <Text style={styles.headerSubtitle}>Offline Equipment Vault</Text>
            </View>
            <TouchableOpacity style={styles.scanIconButton} onPress={navigateToScanner}>
              <Text style={styles.buttonIconText}>📷 Scan QR</Text>
            </TouchableOpacity>
          </View>

          {/* Sync Status Card */}
          <View style={styles.syncCard}>
            <View style={styles.syncCardLeft}>
              <Text style={styles.syncCardLabel}>Offline Database</Text>
              <Text style={styles.syncCardValue}>{assets.length} Assets Loaded</Text>
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
                <Text style={styles.syncButtonText}>Refresh</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Search Bar */}
          <View style={styles.searchSection}>
            <TextInput
              style={styles.searchInput}
              placeholder="Search by asset #, name, model..."
              placeholderTextColor="#64748b"
              value={searchQuery}
              onChangeText={setSearchQuery}
              clearButtonMode="while-editing"
            />
          </View>

          {/* Filter Tabs */}
          <View style={styles.filterContainer}>
            {['All', 'Working', 'Maintenance', 'Faulty'].map((status) => (
              <TouchableOpacity
                key={status}
                onPress={() => setStatusFilter(status)}
                style={[
                  styles.filterTab,
                  statusFilter === status && styles.filterTabActive,
                ]}
              >
                <Text style={[
                  styles.filterTabText,
                  statusFilter === status && styles.filterTabTextActive,
                ]}>{status}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* List */}
          <FlatList
            data={filteredAssets}
            keyExtractor={(item) => item.id.toString()}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.assetCard}
                onPress={() => {
                  setSelectedAssetNumber(item.asset_number);
                  setCurrentScreen('Details');
                }}
              >
                <View style={styles.assetCardHeader}>
                  <Text style={styles.assetCardName}>{item.name}</Text>
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
                <Text style={styles.assetCardCode}>{item.asset_number}</Text>
                <Text style={styles.assetCardModel}>Model: {item.model}</Text>
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>No equipment found locally.</Text>
                <Text style={styles.emptySubtext}>Connect to internet and click Refresh Database.</Text>
              </View>
            }
          />
        </View>
      )}

      {/* SCANNER SCREEN */}
      {currentScreen === 'Scanner' && (
        <View style={styles.scannerContainer}>
          <CameraView
            style={StyleSheet.absoluteFillObject}
            onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          />
          <View style={styles.overlay}>
            <View style={styles.unfocusedContainer}></View>
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
              <Text style={styles.scanInstructions}>Align QR Code inside the frame</Text>
              <TouchableOpacity style={styles.closeScannerButton} onPress={() => setCurrentScreen('Home')}>
                <Text style={styles.closeScannerButtonText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* DETAILS SCREEN */}
      {currentScreen === 'Details' && (() => {
        const asset = assets.find((a) => a.asset_number === selectedAssetNumber);
        return (
          <View style={styles.screenContainer}>
            <View style={styles.detailsHeader}>
              <TouchableOpacity style={styles.backButton} onPress={() => setCurrentScreen('Home')}>
                <Text style={styles.backButtonText}>← Back</Text>
              </TouchableOpacity>
              <Text style={styles.detailsHeaderTitle}>Asset Details</Text>
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
                  ) : null}

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
                      <Text style={styles.sectionLabel}>Model / Manufacturer</Text>
                      <Text style={styles.sectionValue}>{asset.model}</Text>
                    </View>

                    <View style={styles.detailSection}>
                      <Text style={styles.sectionLabel}>Technical Specifications</Text>
                      <Text style={styles.sectionValue}>{asset.specs || '—'}</Text>
                    </View>

                    {asset.background ? (
                      <View style={styles.detailSection}>
                        <Text style={styles.sectionLabel}>Background & Procurement</Text>
                        <Text style={styles.sectionValue}>{asset.background}</Text>
                      </View>
                    ) : null}

                    {asset.instructions ? (
                      <View style={styles.detailSection}>
                        <Text style={styles.sectionLabel}>Installation & Setup Instructions</Text>
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
                  Asset code "{selectedAssetNumber}" is not present in the downloaded offline database.
                </Text>
                <TouchableOpacity style={styles.errorButton} onPress={() => setCurrentScreen('Home')}>
                  <Text style={styles.errorButtonText}>Back to Home</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        );
      })()}
    </SafeAreaView>
  );
}

const { width } = Dimensions.get('window');
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#05081a' },
  screenContainer: { flex: 1, paddingHorizontal: 16 },
  loadingOverlay: { flex: 1, backgroundColor: '#05081a', alignItems: 'center', justifyContent: 'center', padding: 24 },
  loadingTitle: { fontSize: 22, fontWeight: 'bold', color: '#ffffff', marginTop: 20 },
  loadingText: { fontSize: 14, color: '#94a3b8', textAlign: 'center', marginTop: 8 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)' },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: '#ffffff' },
  headerSubtitle: { fontSize: 12, color: '#22d3ee', fontWeight: '600', marginTop: 2 },
  scanIconButton: { backgroundColor: 'rgba(34,211,238,0.1)', borderWidth: 1, borderColor: 'rgba(34,211,238,0.3)', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8 },
  buttonIconText: { color: '#22d3ee', fontWeight: 'bold', fontSize: 14 },
  syncCard: { backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: 12, padding: 16, marginVertical: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  syncCardLeft: { flex: 1 },
  syncCardLabel: { fontSize: 11, fontWeight: '700', color: '#64748b', textTransform: 'uppercase' },
  syncCardValue: { fontSize: 16, fontWeight: 'bold', color: '#ffffff', marginVertical: 2 },
  syncCardTimestamp: { fontSize: 11, color: '#94a3b8' },
  syncButton: { backgroundColor: 'rgba(34,211,238,0.1)', borderWidth: 1, borderColor: 'rgba(34,211,238,0.2)', paddingVertical: 10, paddingHorizontal: 18, borderRadius: 8, alignItems: 'center', justifyContent: 'center', minWidth: 70 },
  syncButtonText: { color: '#22d3ee', fontWeight: 'bold', fontSize: 13 },
  searchSection: { marginBottom: 12 },
  searchInput: { backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', borderRadius: 8, paddingVertical: 12, paddingHorizontal: 16, color: '#e2e8f0', fontSize: 14 },
  filterContainer: { flexDirection: 'row', marginBottom: 16 },
  filterTab: { flex: 1, paddingVertical: 8, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.02)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.04)', marginHorizontal: 2, borderRadius: 6 },
  filterTabActive: { backgroundColor: 'rgba(34,211,238,0.1)', borderColor: 'rgba(34,211,238,0.3)' },
  filterTabText: { fontSize: 12, color: '#94a3b8', fontWeight: '600' },
  filterTabTextActive: { color: '#22d3ee' },
  listContent: { paddingBottom: 24 },
  assetCard: { backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: 10, padding: 14, marginBottom: 12 },
  assetCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  assetCardName: { fontSize: 15, fontWeight: 'bold', color: '#ffffff', flex: 1, marginRight: 8 },
  assetCardCode: { fontFamily: 'monospace', fontSize: 12, color: '#22d3ee', fontWeight: '600', marginBottom: 4 },
  assetCardModel: { fontSize: 12, color: '#94a3b8' },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 99, borderWidth: 1 },
  badgeWorking: { backgroundColor: 'rgba(16, 185, 129, 0.1)', borderColor: 'rgba(16, 185, 129, 0.25)' },
  badgeMaintenance: { backgroundColor: 'rgba(245, 158, 11, 0.1)', borderColor: 'rgba(245, 158, 11, 0.25)' },
  badgeFaulty: { backgroundColor: 'rgba(239, 68, 68, 0.1)', borderColor: 'rgba(239, 68, 68, 0.25)' },
  badgeText: { fontSize: 10, fontWeight: '700' },
  badgeTextWorking: { color: '#34d399' },
  badgeTextMaintenance: { color: '#fbbf24' },
  badgeTextFaulty: { color: '#f87171' },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48 },
  emptyText: { color: '#94a3b8', fontSize: 15, fontWeight: '600' },
  emptySubtext: { color: '#64748b', fontSize: 12, marginTop: 4 },
  scannerContainer: { flex: 1, backgroundColor: '#000000' },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  unfocusedContainer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' },
  middleContainer: { flexDirection: 'row', height: width * 0.7 },
  focusedContainer: { width: width * 0.7, height: width * 0.7, position: 'relative' },
  scanTargetCornerTL: { position: 'absolute', top: 0, left: 0, width: 30, height: 30, borderTopWidth: 4, borderLeftWidth: 4, borderColor: '#22d3ee' },
  scanTargetCornerTR: { position: 'absolute', top: 0, right: 0, width: 30, height: 30, borderTopWidth: 4, borderRightWidth: 4, borderColor: '#22d3ee' },
  scanTargetCornerBL: { position: 'absolute', bottom: 0, left: 0, width: 30, height: 30, borderBottomWidth: 4, borderLeftWidth: 4, borderColor: '#22d3ee' },
  scanTargetCornerBR: { position: 'absolute', bottom: 0, right: 0, width: 30, height: 30, borderBottomWidth: 4, borderRightWidth: 4, borderColor: '#22d3ee' },
  scanInstructions: { color: '#ffffff', fontSize: 14, fontWeight: '600', textAlign: 'center', marginBottom: 24 },
  closeScannerButton: { backgroundColor: 'rgba(255,255,255,0.12)', paddingVertical: 12, paddingHorizontal: 28, borderRadius: 8 },
  closeScannerButtonText: { color: '#ffffff', fontWeight: 'bold', fontSize: 14 },
  detailsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)' },
  backButton: { paddingVertical: 6, paddingHorizontal: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 6 },
  backButtonText: { color: '#e2e8f0', fontWeight: '600', fontSize: 13 },
  detailsHeaderTitle: { fontSize: 18, fontWeight: 'bold', color: '#ffffff' },
  detailsContent: { paddingVertical: 16 },
  detailsCard: { backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: 12, overflow: 'hidden' },
  detailsImage: { width: '100%', height: 200, resizeMode: 'cover' },
  detailsCardContent: { padding: 20 },
  detailsRowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  detailsAssetCode: { fontFamily: 'monospace', fontSize: 16, fontWeight: '700', color: '#22d3ee' },
  detailsName: { fontSize: 20, fontWeight: 'bold', color: '#ffffff', marginBottom: 20 },
  detailSection: { marginBottom: 16 },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: '#64748b', textTransform: 'uppercase', marginBottom: 4 },
  sectionValue: { fontSize: 14, color: '#e2e8f0', lineHeight: 20 },
  descriptionBox: { backgroundColor: 'rgba(255,255,255,0.02)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: 14, marginTop: 4 },
  descriptionText: { fontSize: 13, color: '#cbd5e1', lineHeight: 20 },
  errorContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 80 },
  errorTitle: { fontSize: 18, fontWeight: 'bold', color: '#f87171', marginBottom: 8 },
  errorText: { fontSize: 14, color: '#94a3b8', textAlign: 'center', paddingHorizontal: 24, marginBottom: 24, lineHeight: 20 },
  errorButton: { backgroundColor: 'rgba(255,255,255,0.1)', paddingVertical: 12, paddingHorizontal: 24, borderRadius: 8 },
  errorButtonText: { color: '#ffffff', fontWeight: '600', fontSize: 14 },
});
