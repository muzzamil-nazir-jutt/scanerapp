const fs = require('fs');

const appJsPath = '/home/muzzamil/Desktop/scan/manager/App.js';
let appJs = fs.readFileSync(appJsPath, 'utf8');

const oldSyncFn = `  const handleSyncFromCloud = () => {
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
                throw new Error(\`Server returned status \${response.status}\`);
              }
              const payload = await response.json();
              const cleanData = Array.isArray(payload) ? payload : (payload.data || []);
              
              if (Array.isArray(cleanData)) {
                await saveAssetsToStorage(cleanData);
                Alert.alert('Sync Complete', \`Database restored! Total \${cleanData.length} assets loaded.\`);
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
  };`;

const newSyncFn = `  // Sync / Restore from GitHub Cloud
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

  const handleSyncFromCloud = () => {
    Alert.alert(
      'Sync from GitHub',
      'This will download both equipment_data.json and equipment_images.json from GitHub and overwrite your local Manager database. Do you want to proceed?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sync Now',
          onPress: async () => {
            try {
              setLoading(true);
              
              // 1. Fetch Data
              const dataRes = await fetch('https://raw.githubusercontent.com/muzzamil-nazir-jutt/scanerapp/main/equipment_data.json', {
                headers: { 'Cache-Control': 'no-cache' },
              });
              if (!dataRes.ok) throw new Error(\`Data fetch returned \${dataRes.status}\`);
              const dataPayload = await dataRes.json();
              const cleanData = Array.isArray(dataPayload) ? dataPayload : (dataPayload.data || []);
              
              if (!Array.isArray(cleanData)) {
                throw new Error('Invalid Data JSON structure.');
              }

              // 2. Fetch Images (if available)
              let imagesPayload = null;
              try {
                const imgRes = await fetch('https://raw.githubusercontent.com/muzzamil-nazir-jutt/scanerapp/main/equipment_images.json', {
                  headers: { 'Cache-Control': 'no-cache' },
                });
                if (imgRes.ok) {
                  imagesPayload = await imgRes.json();
                }
              } catch (imgErr) {
                console.warn("Images sync failed or not available:", imgErr);
              }

              // 3. Merge
              const mergedData = mergeImagesIntoData(cleanData, imagesPayload);
              
              await saveAssetsToStorage(mergedData);
              Alert.alert('Sync Complete', \`Database restored! Total \${mergedData.length} assets loaded.\`);
              
            } catch (err) {
              Alert.alert('Sync Failed', 'Could not download database from GitHub: ' + err.message);
            } finally {
              setLoading(false);
            }
          }
        }
      ]
    );
  };`;

if (appJs.includes('https://raw.githubusercontent.com/muzzamil-nazir-jutt/scanerapp/main/equipment.json')) {
  // Replace using substring or replace
  appJs = appJs.replace(oldSyncFn, newSyncFn);
  fs.writeFileSync(appJsPath, appJs, 'utf8');
  console.log("manager/App.js updated successfully.");
} else {
  console.log("Could not find the old sync function block.");
}
