import { AttachmentMeta } from './models';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export async function compressImageClient(
  file: File,
  maxWidth = 1280,
  quality = 0.78
): Promise<{ blob: Blob; dataUrl: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Could not get canvas context'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('Compression failed'));
              return;
            }
            resolve({ blob, dataUrl, width, height });
          },
          'image/jpeg',
          quality
        );
      };
      img.onerror = () => reject(new Error('Invalid image file'));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error('Error reading file'));
    reader.readAsDataURL(file);
  });
}

export async function uploadReceiptAttachment(
  file: File,
  householdId: string
): Promise<AttachmentMeta> {
  if (file.type && !ALLOWED_TYPES.includes(file.type.toLowerCase()) && !file.type.startsWith('image/')) {
    throw new Error('Solo se permiten imágenes (JPG, PNG, WEBP, HEIC).');
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error('La imagen supera el límite máximo de 10 MB.');
  }

  // Compress on client before uploading (RF-06)
  const compressed = await compressImageClient(file, 1280, 0.78);

  // Request signature from backend
  const sigRes = await fetch('/api/uploads/signature', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ householdId }),
  });

  const sigData = await sigRes.json();

  if (sigData.configured && sigData.signature && sigData.cloudName && sigData.apiKey) {
    const formData = new FormData();
    formData.append('file', compressed.blob, file.name.replace(/\.[^/.]+$/, '') + '.jpg');
    formData.append('api_key', sigData.apiKey);
    formData.append('timestamp', String(sigData.timestamp));
    formData.append('signature', sigData.signature);
    formData.append('folder', sigData.folder);

    const uploadRes = await fetch(
      `https://api.cloudinary.com/v1_1/${sigData.cloudName}/image/upload`,
      {
        method: 'POST',
        body: formData,
      }
    );

    if (uploadRes.ok) {
      const cloudResult = await uploadRes.json();
      return {
        id: cloudResult.asset_id || `att_${Date.now()}`,
        publicId: cloudResult.public_id,
        secureUrl: cloudResult.secure_url,
        format: cloudResult.format || 'jpg',
        bytes: cloudResult.bytes || compressed.blob.size,
        width: cloudResult.width || compressed.width,
        height: cloudResult.height || compressed.height,
        uploadedAt: new Date().toISOString(),
      };
    }
  }

  // Fallback to strongly compressed thumbnail dataUrl if Cloudinary keys are not yet in .env
  const fallbackCompressed = await compressImageClient(file, 720, 0.65);
  return {
    id: `local_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    publicId: `local_${householdId}_${Date.now()}`,
    secureUrl: fallbackCompressed.dataUrl,
    format: 'jpg',
    bytes: fallbackCompressed.blob.size,
    width: fallbackCompressed.width,
    height: fallbackCompressed.height,
    uploadedAt: new Date().toISOString(),
  };
}

export async function deleteReceiptAttachment(publicId: string): Promise<void> {
  if (!publicId || publicId.startsWith('local_')) return;
  try {
    await fetch(`/api/uploads/signature?publicId=${encodeURIComponent(publicId)}`, {
      method: 'DELETE',
    });
  } catch (err) {
    console.warn('Error deleting attachment from Cloudinary:', err);
  }
}
