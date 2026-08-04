// Compressão de imagem NO NAVEGADOR, antes de enviar ao servidor.
//
// Por que isto existe: a Vercel corta qualquer envio acima de ~4,5 MB antes de
// a requisição chegar no nosso código. Uma foto de celular tem de 2 a 5 MB, e
// o cardápio manda várias de uma vez — sem comprimir aqui, publicar 3 fotos
// falharia. Reduzindo para ~1600px de largura em WebP, cada foto sai com uns
// 200–400 KB e o conjunto inteiro fica bem abaixo do limite.
//
// O servidor continua comprimindo de novo (1200px, WebP q80): esta etapa é
// para o arquivo CHEGAR lá, não substitui a otimização final.

export const UPLOAD_MAX_WIDTH = 1600;
export const UPLOAD_QUALITY = 0.8;

// Teto prático de um envio para a Vercel (4,5 MB), com folga para os títulos e
// o cabeçalho da requisição.
export const UPLOAD_TOTAL_LIMIT = 4 * 1024 * 1024;

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

// Troca a extensão do nome do arquivo (só cosmético, para o histórico).
function renameTo(name: string, ext: string): string {
  return name.replace(/\.[^.]+$/, "") + ext;
}

// Reduz e reencoda uma imagem. Se qualquer etapa falhar (navegador antigo,
// formato que ele não decodifica), devolve o arquivo ORIGINAL — aí o envio
// segue como antes e o servidor decide se aceita.
export async function compressImage(file: File): Promise<File> {
  try {
    // imageOrientation "from-image" aplica a rotação do EXIF ao desenhar. Sem
    // isso, foto tirada em pé sairia deitada depois de reencodada.
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });

    const scale = Math.min(1, UPLOAD_MAX_WIDTH / bitmap.width);
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    // WebP é bem menor; se o navegador não souber gerar (devolve PNG, que fica
    // maior que o original), tenta JPEG.
    let blob = await canvasToBlob(canvas, "image/webp", UPLOAD_QUALITY);
    let ext = ".webp";
    if (!blob || blob.type !== "image/webp") {
      blob = await canvasToBlob(canvas, "image/jpeg", UPLOAD_QUALITY);
      ext = ".jpg";
    }
    if (!blob) return file;

    // Se por acaso ficou maior (imagem já pequena/otimizada), mantém a original.
    if (blob.size >= file.size) return file;

    return new File([blob], renameTo(file.name, ext), {
      type: blob.type,
      lastModified: Date.now(),
    });
  } catch {
    return file;
  }
}

// "2,3 MB" / "412 KB" — para mostrar tamanhos na tela.
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
