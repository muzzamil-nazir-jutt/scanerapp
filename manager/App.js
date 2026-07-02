import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Image,
  Alert,
  ActivityIndicator,
  SafeAreaView,
  StatusBar,
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import QRCode from 'react-native-qrcode-svg';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy'; // Fixed deprecation issue
import QRCodeLib from 'qrcode';

const STORAGE_KEY = '@voltsync_assets';

export default function App() {
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  
  // Navigation State
  const [activeTab, setActiveTab] = useState('list'); // 'list', 'form', 'detail'
  const [selectedAsset, setSelectedAsset] = useState(null);
  
  // Form State
  const [isEditing, setIsEditing] = useState(false);
  const [formLoading, setFormLoading] = useState(false);
  const [formData, setFormData] = useState({
    asset_number: '',
    name: '',
    model: '',
    status: 'Working',
    descriptionBlocks: [], // Array of { id, type, value }
    instructionBlocks: [], // Array of { id, type, value }
  });

  // Load assets on mount
  useEffect(() => {
    loadAssets();
  }, []);

  const loadAssets = async () => {
    try {
      setLoading(true);
      const jsonValue = await AsyncStorage.getItem(STORAGE_KEY);
      if (jsonValue != null) {
        setAssets(JSON.parse(jsonValue));
      } else {
        setAssets([]);
      }
    } catch (e) {
      Alert.alert('Error', 'Failed to load assets from storage.');
    } finally {
      setLoading(false);
    }
  };

  const saveAssetsToStorage = async (updatedAssets) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updatedAssets));
      setAssets(updatedAssets);
    } catch (e) {
      Alert.alert('Error', 'Failed to save changes to storage.');
    }
  };

  // Sync / Restore from GitHub Cloud
  const handleSyncFromCloud = () => {
    Alert.alert(
      'Sync from GitHub',
      'This will download the database from GitHub and overwrite your local Manager database. Do you want to proceed?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sync Now',
          onPress: async () => {
            try {
              setLoading(true);
              const response = await fetch('https://raw.githubusercontent.com/muzzamil-nazir-jutt/scanerapp/main/equipment.json', {
                headers: { 'Cache-Control': 'no-cache' },
              });
              if (!response.ok) {
                throw new Error(`Server returned status ${response.status}`);
              }
              const payload = await response.json();
              const cleanData = Array.isArray(payload) ? payload : (payload.data || []);
              
              if (Array.isArray(cleanData)) {
                await saveAssetsToStorage(cleanData);
                Alert.alert('Sync Complete', `Database restored! Total ${cleanData.length} assets loaded.`);
              } else {
                throw new Error('Invalid JSON structure.');
              }
            } catch (err) {
              Alert.alert('Sync Failed', 'Could not download database from GitHub: ' + err.message);
            } finally {
              setLoading(false);
            }
          }
        }
      ]
    );
  };

  // Auto-calculate next sequential number
  const getNextAssetNumber = () => {
    if (assets.length === 0) return '1';
    const numbers = assets.map(a => parseInt(a.asset_number, 10)).filter(n => !isNaN(n));
    if (numbers.length === 0) return '1';
    const max = Math.max(...numbers);
    return (max + 1).toString();
  };

  const handleOpenAddForm = () => {
    setIsEditing(false);
    setFormData({
      asset_number: getNextAssetNumber(),
      name: '',
      model: '',
      status: 'Working',
      descriptionBlocks: [],
      instructionBlocks: [],
    });
    setActiveTab('form');
  };

  const handleOpenEditForm = (asset) => {
    setIsEditing(true);

    // Backward compatibility: Convert legacy strings to blocks if blocks don't exist
    let descBlocks = asset.descriptionBlocks || [];
    if (descBlocks.length === 0) {
      if (asset.specs) {
        descBlocks.push({
          id: 'legacy-specs-' + Date.now(),
          type: 'text',
          value: asset.specs,
        });
      }
      if (asset.background) {
        descBlocks.push({
          id: 'legacy-bg-' + Date.now(),
          type: 'text',
          value: asset.background,
        });
      }
      if (asset.image) {
        descBlocks.push({
          id: 'legacy-img-' + Date.now(),
          type: 'image',
          value: asset.image,
        });
      }
    }

    let instBlocks = asset.instructionBlocks || [];
    if (instBlocks.length === 0 && asset.instructions) {
      instBlocks.push({
        id: 'legacy-inst-' + Date.now(),
        type: 'text',
        value: asset.instructions,
      });
    }

    setFormData({
      asset_number: asset.asset_number,
      name: asset.name,
      model: asset.model,
      status: asset.status,
      descriptionBlocks: descBlocks,
      instructionBlocks: instBlocks,
    });
    setActiveTab('form');
  };

  // Generic Image Selection and Compression for block builder
  const pickImageForBlocks = async (useCamera, blocks, setBlocks) => {
    try {
      let result;
      if (useCamera) {
        const cameraPermission = await ImagePicker.requestCameraPermissionsAsync();
        if (!cameraPermission.granted) {
          Alert.alert('Permission Denied', 'Camera access is required to take photos.');
          return;
        }
        result = await ImagePicker.launchCameraAsync({
          allowsEditing: true,
          aspect: [4, 3],
          quality: 0.8,
        });
      } else {
        const galleryPermission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!galleryPermission.granted) {
          Alert.alert('Permission Denied', 'Gallery access is required to choose photos.');
          return;
        }
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsEditing: true,
          aspect: [4, 3],
          quality: 0.8,
        });
      }

      if (!result.canceled && result.assets && result.assets[0]) {
        setFormLoading(true);
        // Compress and resize image
        const manipResult = await ImageManipulator.manipulateAsync(
          result.assets[0].uri,
          [{ resize: { width: 800 } }], // Resize to max 800px width
          { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true }
        );
        
        const newBlock = {
          id: Date.now().toString() + Math.random().toString(36).substring(7),
          type: 'image',
          value: manipResult.base64,
        };
        setBlocks([...blocks, newBlock]);
      }
    } catch (e) {
      Alert.alert('Error', 'Failed to process image: ' + e.message);
    } finally {
      setFormLoading(false);
    }
  };

  const handleFormSubmit = async () => {
    if (!formData.name.trim() || !formData.model.trim() || !formData.asset_number.trim()) {
      Alert.alert('Validation Error', 'Please fill in the Asset Number, Name, and Model.');
      return;
    }

    const assetNum = formData.asset_number.trim();

    // Check for duplicate asset numbers if creating new
    if (!isEditing) {
      const exists = assets.some(a => a.asset_number === assetNum);
      if (exists) {
        Alert.alert('Duplicate Asset Number', 'An asset with this number already exists. Please use a unique number.');
        return;
      }
    }

    setFormLoading(true);
    let updatedAssets = [...assets];

    const firstImage = 
      formData.descriptionBlocks.find(b => b.type === 'image')?.value || 
      formData.instructionBlocks.find(b => b.type === 'image')?.value || 
      null;

    const newAsset = {
      id: isEditing ? assets.find(a => a.asset_number === assetNum).id : Date.now(),
      asset_number: assetNum,
      name: formData.name.trim(),
      model: formData.model.trim(),
      status: formData.status,
      descriptionBlocks: formData.descriptionBlocks,
      instructionBlocks: formData.instructionBlocks,
      
      // Fallbacks for older Scanner Apps
      specs: formData.descriptionBlocks.filter(b => b.type === 'text').map(b => b.value).join('\n'),
      background: '',
      instructions: formData.instructionBlocks.filter(b => b.type === 'text').map(b => b.value).join('\n'),
      image: firstImage,
    };

    if (isEditing) {
      updatedAssets = updatedAssets.map(a => a.asset_number === assetNum ? newAsset : a);
    } else {
      updatedAssets.push(newAsset);
    }

    await saveAssetsToStorage(updatedAssets);
    setFormLoading(false);
    
    // Refresh selected asset if viewing details
    if (selectedAsset && selectedAsset.asset_number === assetNum) {
      setSelectedAsset(newAsset);
    }

    setActiveTab('list');
    Alert.alert('Success', isEditing ? 'Asset updated successfully.' : 'Asset added successfully.');
  };

  const handleDeleteAsset = (assetNum) => {
    Alert.alert(
      'Confirm Delete',
      `Are you sure you want to delete Asset #${assetNum}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const updated = assets.filter(a => a.asset_number !== assetNum);
            await saveAssetsToStorage(updated);
            if (selectedAsset && selectedAsset.asset_number === assetNum) {
              setSelectedAsset(null);
              setActiveTab('list');
            }
          }
        }
      ]
    );
  };

  // Export JSON Database
  const handleExportJSON = async () => {
    if (assets.length === 0) {
      Alert.alert('Empty Database', 'No assets to export. Please add some assets first.');
      return;
    }

    try {
      const exportData = {
        success: true,
        data: assets,
      };

      const fileUri = `${FileSystem.documentDirectory}equipment.json`;
      await FileSystem.writeAsStringAsync(fileUri, JSON.stringify(exportData, null, 2), {
        encoding: FileSystem.EncodingType.UTF8,
      });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri);
      } else {
        Alert.alert('Error', 'Sharing is not available on this device.');
      }
    } catch (e) {
      Alert.alert('Export Failed', 'Failed to export database: ' + e.message);
    }
  };

  // Export QR PDF Labels Sheet (100% Offline)
  const handleExportPDF = async () => {
    if (assets.length === 0) {
      Alert.alert('Empty Database', 'No assets to generate QR codes for.');
      return;
    }

    try {
      setLoading(true);
      let labelsHtml = '';

      // Generate offline QR codes as pure SVG strings (no canvas dependency)
      for (const asset of assets) {
        const qrSvg = await QRCodeLib.toString(asset.asset_number, {
          type: 'svg',
          margin: 1,
        });

        labelsHtml += `
          <div class="label-card">
            <div class="qr-svg-container">${qrSvg}</div>
            <div class="asset-name">${escapeHtml(asset.name)}</div>
            <div class="asset-num">Asset #${asset.asset_number}</div>
          </div>
        `;
      }

      const htmlContent = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <title>VoltSync QR Labels</title>
            <style>
              body {
                font-family: system-ui, -apple-system, sans-serif;
                margin: 10px;
                padding: 0;
                background-color: #ffffff;
              }
              .grid {
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 15px;
              }
              .label-card {
                border: 1.5px solid #cbd5e1;
                border-radius: 12px;
                padding: 12px;
                text-align: center;
                page-break-inside: avoid;
                background-color: #ffffff;
              }
              .qr-svg-container svg {
                width: 130px;
                height: 130px;
                margin: 0 auto 8px auto;
                display: block;
              }
              .asset-name {
                font-size: 11px;
                font-weight: 700;
                color: #0f172a;
                margin: 4px 0 2px 0;
                line-height: 1.2;
                height: 2.4em;
                display: -webkit-box;
                -webkit-line-clamp: 2;
                -webkit-box-orient: vertical;
                overflow: hidden;
              }
              .asset-num {
                font-size: 11px;
                font-family: monospace;
                color: #475569;
                font-weight: 600;
              }
            </style>
          </head>
          <body>
            <h2 style="text-align: center; color: #1e3a8a; margin-top: 10px; margin-bottom: 20px; font-size: 20px;">
              ⚡ VoltSync Asset QR Labels
            </h2>
            <div class="grid">
              ${labelsHtml}
            </div>
          </body>
        </html>
      `;

      const { uri } = await Print.printToFileAsync({ html: htmlContent });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri);
      } else {
        Alert.alert('Error', 'Sharing is not available on this device.');
      }
    } catch (e) {
      Alert.alert('PDF Generation Failed', 'Failed to generate PDF labels: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const escapeHtml = (unsafe) => {
    return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };

  // Filtering and Searching
  const filteredAssets = assets.filter(asset => {
    const matchesSearch = 
      asset.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      asset.model.toLowerCase().includes(searchQuery.toLowerCase()) ||
      asset.asset_number.includes(searchQuery);
    
    const matchesStatus = statusFilter === 'All' || asset.status === statusFilter;
    
    return matchesSearch && matchesStatus;
  });

  const getStatusColor = (status) => {
    switch (status) {
      case 'Working': return '#10b981';
      case 'Maintenance': return '#f59e0b';
      case 'Faulty': return '#ef4444';
      default: return '#94a3b8';
    }
  };

  // Block Builder UI Renderer
  const renderBlockBuilder = (sectionName, blocks, setBlocks) => {
    const addTextBlock = () => {
      setBlocks([...blocks, { id: Date.now().toString() + Math.random(), type: 'text', value: '' }]);
    };

    const updateTextBlock = (id, text) => {
      setBlocks(blocks.map(b => b.id === id ? { ...b, value: text } : b));
    };

    const deleteBlock = (id) => {
      setBlocks(blocks.filter(b => b.id !== id));
    };

    const moveBlock = (index, direction) => {
      const newBlocks = [...blocks];
      const temp = newBlocks[index];
      newBlocks[index] = newBlocks[index + direction];
      newBlocks[index + direction] = temp;
      setBlocks(newBlocks);
    };

    return (
      <View style={styles.blockBuilderContainer}>
        <Text style={styles.blockLabel}>{sectionName}</Text>
        
        {blocks.length === 0 ? (
          <Text style={styles.noBlocksText}>No text or images added yet in this section.</Text>
        ) : (
          blocks.map((block, index) => (
            <View key={block.id} style={styles.blockWrapper}>
              <View style={styles.blockHeader}>
                <Text style={styles.blockTypeText}>
                  {block.type === 'text' ? '📝 TEXT BLOCK' : '🖼️ IMAGE BLOCK'}
                </Text>
                
                {/* Rearrange Arrows */}
                <View style={styles.blockNavButtons}>
                  {index > 0 && (
                    <TouchableOpacity style={styles.navButton} onPress={() => moveBlock(index, -1)}>
                      <Text style={styles.navButtonText}>⬆️</Text>
                    </TouchableOpacity>
                  )}
                  {index < blocks.length - 1 && (
                    <TouchableOpacity style={styles.navButton} onPress={() => moveBlock(index, 1)}>
                      <Text style={styles.navButtonText}>⬇️</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={styles.blockDeleteBtn} onPress={() => deleteBlock(block.id)}>
                    <Text style={styles.deleteText}>❌ Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {block.type === 'text' ? (
                <TextInput
                  style={[styles.inputField, styles.blockTextInput]}
                  multiline
                  placeholder="Enter details here..."
                  placeholderTextColor="#64748b"
                  value={block.value}
                  onChangeText={(txt) => updateTextBlock(block.id, txt)}
                />
              ) : (
                <View style={styles.blockImageWrapper}>
                  <Image
                    source={{ uri: `data:image/jpeg;base64,${block.value}` }}
                    style={styles.blockImagePreview}
                  />
                </View>
              )}
            </View>
          ))
        )}

        {/* Buttons to append new blocks */}
        <View style={styles.blockActionRow}>
          <TouchableOpacity style={styles.blockActionButton} onPress={addTextBlock}>
            <Text style={styles.blockActionButtonText}>✍️ Add Text</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.blockActionButton} onPress={() => pickImageForBlocks(true, blocks, setBlocks)}>
            <Text style={styles.blockActionButtonText}>📸 Take Photo</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.blockActionButton} onPress={() => pickImageForBlocks(false, blocks, setBlocks)}>
            <Text style={styles.blockActionButtonText}>🖼️ Gallery</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  // Block View Renderer (Details Screen)
  const renderBlockList = (blocks) => {
    if (!blocks || blocks.length === 0) return <Text style={styles.sectionText}>—</Text>;
    return blocks.map((block) => {
      if (block.type === 'text') {
        return (
          <Text key={block.id} style={styles.detailsBlockText}>
            {block.value}
          </Text>
        );
      } else {
        return (
          <Image
            key={block.id}
            source={{ uri: `data:image/jpeg;base64,${block.value}` }}
            style={styles.detailsBlockImage}
          />
        );
      }
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#05081a" />
      
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>⚡ VoltSync Manager</Text>
        <Text style={styles.headerSubtitle}>Offline Database Creator</Text>
      </View>

      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#00b4d8" />
          <Text style={styles.loadingText}>Loading database...</Text>
        </View>
      ) : (
        <>
          {/* LIST VIEW */}
          {activeTab === 'list' && (
            <View style={{ flex: 1 }}>
              {/* Toolbar */}
              <View style={styles.toolbar}>
                <TouchableOpacity style={[styles.toolButton, { backgroundColor: '#1e293b' }]} onPress={handleSyncFromCloud}>
                  <Text style={styles.toolButtonText}>🔄 Sync Cloud</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.toolButton, { backgroundColor: '#1e293b' }]} onPress={handleExportJSON}>
                  <Text style={styles.toolButtonText}>📥 Export JSON</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.toolButton, { backgroundColor: '#1e293b' }]} onPress={handleExportPDF}>
                  <Text style={styles.toolButtonText}>📄 Print QRs</Text>
                </TouchableOpacity>
              </View>

              {/* Search & Filter */}
              <View style={styles.searchContainer}>
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search by name, model, number..."
                  placeholderTextColor="#64748b"
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                />
                <View style={styles.filterRow}>
                  {['All', 'Working', 'Maintenance', 'Faulty'].map(status => (
                    <TouchableOpacity
                      key={status}
                      style={[
                        styles.filterButton,
                        statusFilter === status && styles.filterButtonActive
                      ]}
                      onPress={() => setStatusFilter(status)}
                    >
                      <Text style={[
                        styles.filterButtonText,
                        statusFilter === status && styles.filterButtonTextActive
                      ]}>
                        {status}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Asset Cards List */}
              <ScrollView style={styles.listContainer} contentContainerStyle={{ paddingBottom: 100 }}>
                {filteredAssets.length === 0 ? (
                  <View style={styles.emptyContainer}>
                    <Text style={styles.emptyText}>No assets found.</Text>
                    <Text style={styles.emptySubtext}>Click the button below to add your first asset.</Text>
                  </View>
                ) : (
                  filteredAssets.map(asset => (
                    <TouchableOpacity
                      key={asset.id}
                      style={styles.assetCard}
                      onPress={() => {
                        setSelectedAsset(asset);
                        setActiveTab('detail');
                      }}
                    >
                      {/* Show the first image block if available, fallback to legacy image */}
                      {(() => {
                        const imgBase64 = 
                          asset.descriptionBlocks?.find(b => b.type === 'image')?.value || 
                          asset.instructionBlocks?.find(b => b.type === 'image')?.value || 
                          asset.image;
                        return imgBase64 ? (
                          <Image
                            source={{ uri: `data:image/jpeg;base64,${imgBase64}` }}
                            style={styles.cardImage}
                          />
                        ) : (
                          <View style={styles.cardImagePlaceholder}>
                            <Text style={styles.placeholderText}>No Image</Text>
                          </View>
                        );
                      })()}
                      
                      <View style={styles.cardDetails}>
                        <View style={styles.cardHeaderRow}>
                          <Text style={styles.cardTitle} numberOfLines={1}>{asset.name}</Text>
                          <View style={[styles.statusDot, { backgroundColor: getStatusColor(asset.status) }]} />
                        </View>
                        <Text style={styles.cardSubtitle} numberOfLines={1}>{asset.model}</Text>
                        <Text style={styles.cardTag}>Asset #{asset.asset_number}</Text>
                      </View>
                    </TouchableOpacity>
                  ))
                )}
              </ScrollView>

              {/* Floating Action Button */}
              <TouchableOpacity style={styles.fab} onPress={handleOpenAddForm}>
                <Text style={styles.fabText}>+</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ADD / EDIT FORM VIEW */}
          {activeTab === 'form' && (
            <ScrollView style={styles.formContainer} contentContainerStyle={{ paddingBottom: 80 }} showsVerticalScrollIndicator={false}>
              <Text style={styles.sectionTitle}>{isEditing ? 'Edit Asset Details' : 'Add New Asset'}</Text>
              
              <Text style={styles.inputLabel}>Asset Number (Unique)</Text>
              <TextInput
                style={[styles.inputField, isEditing && styles.inputFieldDisabled]}
                value={formData.asset_number}
                onChangeText={(text) => setFormData(prev => ({ ...prev, asset_number: text }))}
                placeholder="e.g., 1"
                placeholderTextColor="#64748b"
                keyboardType="numeric"
                editable={!isEditing}
              />
              {isEditing && <Text style={styles.helpText}>Asset number is locked to preserve printed QR codes.</Text>}

              <Text style={styles.inputLabel}>Asset Name</Text>
              <TextInput
                style={styles.inputField}
                value={formData.name}
                onChangeText={(text) => setFormData(prev => ({ ...prev, name: text }))}
                placeholder="e.g., Steam Turbine"
                placeholderTextColor="#64748b"
              />

              <Text style={styles.inputLabel}>Model / Manufacturer</Text>
              <TextInput
                style={styles.inputField}
                value={formData.model}
                onChangeText={(text) => setFormData(prev => ({ ...prev, model: text }))}
                placeholder="e.g., Siemens SST-600"
                placeholderTextColor="#64748b"
              />

              <Text style={styles.inputLabel}>Status</Text>
              <View style={styles.statusPickerRow}>
                {['Working', 'Maintenance', 'Faulty'].map(status => (
                  <TouchableOpacity
                    key={status}
                    style={[
                      styles.statusPickerButton,
                      formData.status === status && { backgroundColor: getStatusColor(status) + '30', borderColor: getStatusColor(status) }
                    ]}
                    onPress={() => setFormData(prev => ({ ...prev, status }))}
                  >
                    <View style={[styles.statusDot, { backgroundColor: getStatusColor(status) }]} />
                    <Text style={[
                      styles.statusPickerText,
                      formData.status === status && { color: '#ffffff', fontWeight: 'bold' }
                    ]}>
                      {status}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Block builder for Description & Specs */}
              {renderBlockBuilder(
                'Description & Technical Specs (Jitni marzi photos add karein)',
                formData.descriptionBlocks,
                (blks) => setFormData(prev => ({ ...prev, descriptionBlocks: blks }))
              )}

              {/* Block builder for Installation instructions */}
              {renderBlockBuilder(
                'Installation Instructions (Mix text & pictures sequentially)',
                formData.instructionBlocks,
                (blks) => setFormData(prev => ({ ...prev, instructionBlocks: blks }))
              )}

              {formLoading ? (
                <ActivityIndicator size="large" color="#00b4d8" style={{ marginTop: 30 }} />
              ) : (
                <View style={styles.formButtonsRow}>
                  <TouchableOpacity style={[styles.formButton, styles.btnCancel]} onPress={() => setActiveTab('list')}>
                    <Text style={styles.formButtonText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.formButton, styles.btnSave]} onPress={handleFormSubmit}>
                    <Text style={[styles.formButtonText, { color: '#fff' }]}>Save Asset</Text>
                  </TouchableOpacity>
                </View>
              )}
            </ScrollView>
          )}

          {/* ASSET DETAIL VIEW */}
          {activeTab === 'detail' && selectedAsset && (
            <ScrollView style={styles.detailContainer} contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
              {/* Back Button */}
              <TouchableOpacity style={styles.backButton} onPress={() => setActiveTab('list')}>
                <Text style={styles.backButtonText}>← Back to List</Text>
              </TouchableOpacity>

              {/* Top Details Card */}
              <View style={styles.detailCard}>
                {(() => {
                  const imgBase64 = 
                    selectedAsset.descriptionBlocks?.find(b => b.type === 'image')?.value || 
                    selectedAsset.instructionBlocks?.find(b => b.type === 'image')?.value || 
                    selectedAsset.image;
                  return imgBase64 ? (
                    <Image
                      source={{ uri: `data:image/jpeg;base64,${imgBase64}` }}
                      style={styles.detailImage}
                    />
                  ) : (
                    <View style={styles.detailImagePlaceholder}>
                      <Text style={styles.placeholderText}>No Image Attached</Text>
                    </View>
                  );
                })()}

                <View style={styles.detailMainInfo}>
                  <View style={styles.detailHeaderRow}>
                    <Text style={styles.detailTitle}>{selectedAsset.name}</Text>
                    <View style={[styles.statusBadge, { backgroundColor: getStatusColor(selectedAsset.status) + '20', borderColor: getStatusColor(selectedAsset.status) }]}>
                      <Text style={[styles.statusBadgeText, { color: getStatusColor(selectedAsset.status) }]}>{selectedAsset.status}</Text>
                    </View>
                  </View>
                  <Text style={styles.detailSubtitle}>{selectedAsset.model}</Text>
                  <Text style={styles.detailTag}>Asset Number: {selectedAsset.asset_number}</Text>
                </View>
              </View>

              {/* QR Code Container */}
              <View style={styles.detailSection}>
                <Text style={styles.detailSectionTitle}>Asset QR Code</Text>
                <View style={styles.qrContainer}>
                  <QRCode
                    value={selectedAsset.asset_number}
                    size={180}
                    color="#000000"
                    backgroundColor="#ffffff"
                  />
                  <Text style={styles.qrText}>Scan this code to view asset details offline</Text>
                </View>
              </View>

              {/* Sequential Description Blocks */}
              <View style={styles.detailSection}>
                <Text style={styles.detailSectionTitle}>Description & Specs</Text>
                {renderBlockList(selectedAsset.descriptionBlocks || [
                  // Fallbacks to legacy data if empty
                  ...(selectedAsset.specs ? [{ id: 'l-specs', type: 'text', value: selectedAsset.specs }] : []),
                  ...(selectedAsset.background ? [{ id: 'l-bg', type: 'text', value: selectedAsset.background }] : []),
                  ...(selectedAsset.image ? [{ id: 'l-img', type: 'image', value: selectedAsset.image }] : []),
                ])}
              </View>

              {/* Sequential Installation Blocks */}
              <View style={styles.detailSection}>
                <Text style={styles.detailSectionTitle}>Installation Guide</Text>
                {renderBlockList(selectedAsset.instructionBlocks || [
                  // Fallbacks to legacy data if empty
                  ...(selectedAsset.instructions ? [{ id: 'l-inst', type: 'text', value: selectedAsset.instructions }] : []),
                ])}
              </View>

              {/* Actions */}
              <View style={styles.detailActionsRow}>
                <TouchableOpacity
                  style={[styles.actionButton, { backgroundColor: '#e2e8f0' }]}
                  onPress={() => handleOpenEditForm(selectedAsset)}
                >
                  <Text style={[styles.actionButtonText, { color: '#0f172a' }]}>✏️ Edit Details</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionButton, { backgroundColor: '#ef444420', borderColor: '#ef4444', borderWidth: 1 }]}
                  onPress={() => handleDeleteAsset(selectedAsset.asset_number)}
                >
                  <Text style={[styles.actionButtonText, { color: '#ef4444' }]}>🗑️ Delete Asset</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          )}
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#05081a',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#94a3b8',
    marginTop: 10,
    fontSize: 14,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? 40 : 15,
    paddingBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
    backgroundColor: '#070c24',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#00b4d8',
    marginTop: 2,
    fontWeight: '600',
  },
  // Toolbar
  toolbar: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 12,
    backgroundColor: '#070c24',
  },
  toolButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  toolButtonText: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: 'bold',
  },
  // Search & Filter
  searchContainer: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#070c24',
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  searchInput: {
    height: 44,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 8,
    paddingHorizontal: 15,
    color: '#ffffff',
    fontSize: 14,
  },
  filterRow: {
    flexDirection: 'row',
    marginTop: 10,
    gap: 8,
  },
  filterButton: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  filterButtonActive: {
    backgroundColor: '#00b4d820',
    borderColor: '#00b4d8',
  },
  filterButtonText: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '600',
  },
  filterButtonTextActive: {
    color: '#00b4d8',
    fontWeight: 'bold',
  },
  // List
  listContainer: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 15,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 100,
  },
  emptyText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  emptySubtext: {
    color: '#64748b',
    fontSize: 12,
    marginTop: 5,
    textAlign: 'center',
  },
  assetCard: {
    flexDirection: 'row',
    backgroundColor: '#0b1329',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#1c2541',
  },
  cardImage: {
    width: 70,
    height: 70,
    borderRadius: 8,
  },
  cardImagePlaceholder: {
    width: 70,
    height: 70,
    borderRadius: 8,
    backgroundColor: '#1e293b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: '600',
  },
  cardDetails: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'center',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitle: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: 'bold',
    flex: 1,
    marginRight: 10,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  cardSubtitle: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 2,
  },
  cardTag: {
    color: '#00b4d8',
    fontSize: 11,
    fontWeight: '600',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    marginTop: 4,
  },
  fab: {
    position: 'absolute',
    bottom: 30,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#22d3ee',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#22d3ee',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8,
  },
  fabText: {
    color: '#05081a',
    fontSize: 28,
    fontWeight: 'bold',
    lineHeight: Platform.OS === 'ios' ? 28 : 34,
  },
  // Form Screen
  formContainer: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 15,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#94a3b8',
    textTransform: 'uppercase',
    marginBottom: 6,
    marginTop: 15,
  },
  inputField: {
    height: 44,
    backgroundColor: '#0b1329',
    borderWidth: 1,
    borderColor: '#1c2541',
    borderRadius: 8,
    paddingHorizontal: 12,
    color: '#ffffff',
    fontSize: 14,
  },
  inputFieldDisabled: {
    backgroundColor: '#070c24',
    color: '#64748b',
    borderColor: '#0f172a',
  },
  helpText: {
    color: '#94a3b8',
    fontSize: 11,
    marginTop: 4,
  },
  statusPickerRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  statusPickerButton: {
    flex: 1,
    flexDirection: 'row',
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1c2541',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#0b1329',
  },
  statusPickerText: {
    fontSize: 12,
    color: '#64748b',
  },
  formButtonsRow: {
    flexDirection: 'row',
    gap: 15,
    marginTop: 30,
  },
  formButton: {
    flex: 1,
    height: 48,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  formButtonText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#94a3b8',
  },
  btnCancel: {
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
  },
  btnSave: {
    backgroundColor: '#22d3ee',
  },
  
  // Block Builder Styling
  blockBuilderContainer: {
    marginTop: 20,
    backgroundColor: 'rgba(255,255,255,0.01)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    padding: 14,
  },
  blockLabel: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#22d3ee',
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  noBlocksText: {
    color: '#64748b',
    fontSize: 12,
    fontStyle: 'italic',
    marginVertical: 10,
  },
  blockWrapper: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  blockHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
    paddingBottom: 6,
  },
  blockTypeText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#94a3b8',
  },
  blockNavButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  navButton: {
    padding: 4,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 4,
  },
  navButtonText: {
    fontSize: 12,
  },
  blockDeleteBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  deleteText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#f87171',
  },
  blockTextInput: {
    height: 70,
    paddingTop: 8,
    textAlignVertical: 'top',
  },
  blockImageWrapper: {
    width: '100%',
    height: 140,
    borderRadius: 6,
    overflow: 'hidden',
  },
  blockImagePreview: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  blockActionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  blockActionButton: {
    flex: 1,
    height: 38,
    backgroundColor: '#1e293b',
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  blockActionButtonText: {
    color: '#e2e8f0',
    fontSize: 11,
    fontWeight: 'bold',
  },

  // Detail Screen
  detailContainer: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 15,
  },
  backButton: {
    paddingVertical: 8,
    alignSelf: 'flex-start',
    marginBottom: 15,
  },
  backButtonText: {
    color: '#00b4d8',
    fontSize: 14,
    fontWeight: '600',
  },
  detailCard: {
    backgroundColor: '#0b1329',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1c2541',
    overflow: 'hidden',
    marginBottom: 20,
  },
  detailImage: {
    width: '100%',
    height: 200,
    resizeMode: 'cover',
  },
  detailImagePlaceholder: {
    width: '100%',
    height: 120,
    backgroundColor: '#1e293b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailMainInfo: {
    padding: 15,
  },
  detailHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#ffffff',
    flex: 1,
    marginRight: 10,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: 'bold',
  },
  detailSubtitle: {
    color: '#94a3b8',
    fontSize: 14,
    marginTop: 4,
  },
  detailTag: {
    color: '#00b4d8',
    fontSize: 12,
    fontWeight: '600',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    marginTop: 6,
  },
  detailSection: {
    backgroundColor: '#0b1329',
    borderRadius: 12,
    padding: 15,
    borderWidth: 1,
    borderColor: '#1c2541',
    marginBottom: 15,
  },
  detailSectionTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#22d3ee',
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
    paddingBottom: 6,
  },
  sectionText: {
    color: '#e2e8f0',
    fontSize: 13,
    lineHeight: 20,
  },
  qrContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  qrText: {
    color: '#64748b',
    fontSize: 11,
    marginTop: 10,
    textAlign: 'center',
  },
  detailActionsRow: {
    flexDirection: 'row',
    gap: 15,
    marginTop: 20,
  },
  actionButton: {
    flex: 1,
    height: 44,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonText: {
    fontSize: 13,
    fontWeight: 'bold',
  },

  // Blocks details display
  detailsBlockText: {
    color: '#cbd5e1',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 10,
  },
  detailsBlockImage: {
    width: '100%',
    height: 200,
    borderRadius: 8,
    resizeMode: 'cover',
    marginVertical: 12,
  },
});
