// 요율표 이미지 업로드 준비: 서버가 받는 형식(PNG/JPG/WebP/GIF, 3MB 이하)으로 맞춰 base64로 변환
const UPLOADABLE = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const KEEP_AS_IS_BYTES = 2.5 * 1024 * 1024;
const MAX_BYTES = 3 * 1024 * 1024;
const MAX_SIDE = 2400; // 요율표 글자가 읽히는 정도는 유지

export async function prepareImageUpload(file: File): Promise<{ mimeType: string; base64: string }> {
  let blob: Blob = file;
  // 다른 형식(SVG 등)이거나 너무 크면 다시 그려서 변환 (작은 표는 PNG로 선명하게, 큰 사진은 JPEG로)
  if (!UPLOADABLE.includes(file.type) || file.size > KEEP_AS_IS_BYTES) {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff'; // 투명 배경이 JPEG에서 검게 변하지 않도록
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const toBlob = (type: string, quality?: number) =>
        new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
      const png = await toBlob('image/png');
      blob = png && png.size <= KEEP_AS_IS_BYTES ? png : (await toBlob('image/jpeg', 0.9)) || file;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  if (blob.size > MAX_BYTES) throw new Error('이미지가 너무 큽니다. 3MB 이하로 줄여서 다시 올려 주세요.');

  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return { mimeType: blob.type, base64: btoa(binary) };
}
