// أصوات المسح — نغمة قصيرة بالـ WebAudio من غير أي ملف صوت خارجي.
// نفس نغمات الكاشير: صاعدة = قراءة صح، هابطة = باركود مش موجود.
const tone = (from: number, to: number, ms: number, type: OscillatorType) => {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(from, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(to, ctx.currentTime + ms / 2000);
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.05);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + ms / 1000);
    osc.start();
    osc.stop(ctx.currentTime + ms / 1000);
  } catch {
    // المتصفح مش سامح بصوت من غير تفاعل — مش سبب لإيقاف المسح.
  }
};

export const beepSuccess = () => tone(800, 1200, 200, 'sine');
export const beepError = () => tone(300, 200, 300, 'sawtooth');
