const fs = require('fs');

const appJsPath = '/home/muzzamil/Desktop/scan/mobile/App.js';
let appJs = fs.readFileSync(appJsPath, 'utf8');

// 1. Add imports
const importsToAdd = `
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import ImageViewer from 'react-native-image-zoom-viewer';
`;
if (!appJs.includes('react-native-image-zoom-viewer')) {
  appJs = appJs.replace(
    "import { Camera, CameraView } from 'expo-camera';",
    "import { Camera, CameraView } from 'expo-camera';\n" + importsToAdd
  );
}

// 2. Replace Modal
const oldModalStr = `      {/* FULL SCREEN ZOOM MODAL */}
      <Modal
        visible={zoomImage !== null}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setZoomImage(null)}
      >
        <View style={styles.zoomModalOverlay}>
          <TouchableOpacity
            style={styles.zoomCloseBtn}
            onPress={() => setZoomImage(null)}
          >
            <Text style={styles.zoomCloseBtnText}>✕ Close</Text>
          </TouchableOpacity>
          {zoomImage && (
            <Image
              source={{ uri: \`data:image/jpeg;base64,\${zoomImage}\` }}
              style={styles.zoomFullImage}
              resizeMode="contain"
            />
          )}
        </View>
      </Modal>`;

const newModalStr = `      {/* FULL SCREEN ZOOM MODAL */}
      <Modal
        visible={zoomImage !== null}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setZoomImage(null)}
      >
        <ImageViewer
          imageUrls={zoomImage ? [{ url: \`data:image/jpeg;base64,\${zoomImage}\` }] : []}
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
                    const fileUri = FileSystem.documentDirectory + \`voltsync_\${Date.now()}.jpg\`;
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
      </Modal>`;

if (appJs.includes('styles.zoomModalOverlay')) {
  appJs = appJs.replace(oldModalStr, newModalStr);
  fs.writeFileSync(appJsPath, appJs, 'utf8');
  console.log("mobile/App.js updated successfully.");
} else {
  console.log("Could not find the old modal block in mobile/App.js.");
}
