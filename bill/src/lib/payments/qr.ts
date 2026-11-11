import QRCode from 'qrcode';

/** The QR is rendered server-side and shipped as a data URL, so the printed code and the
 *  screen can never disagree about the amount or the payee. */
export async function qrDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 320,
    color: { dark: '#000000ff', light: '#ffffffff' },
  });
}
