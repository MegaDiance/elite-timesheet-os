export function parseSmartTime(val?: string): string {
    if (!val) return '';
    let t = val.toLowerCase().replace(/\s/g, '');
    let isPM = t.includes('p');
    let isAM = t.includes('a');
    t = t.replace(/[^\d:]/g, '');
    if (!t) return '';
    
    let h = 0, m = 0;
    if (t.includes(':')) {
        const parts = t.split(':');
        h = parseInt(parts[0]) || 0;
        m = parseInt(parts[1]) || 0;
    } else {
        if (t.length <= 2) h = parseInt(t);
        else if (t.length === 3) { h = parseInt(t.substring(0, 1)); m = parseInt(t.substring(1)); }
        else if (t.length >= 4) { h = parseInt(t.substring(0, 2)); m = parseInt(t.substring(2, 4)); }
    }
    
    if (isPM && h < 12) h += 12;
    if (isAM && h === 12) h = 0;
    if (h === 12 && !isPM && !isAM && t.length <= 2) h = 12;
    if (h > 23) h = 23;
    if (m > 59) m = 59;
    
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

export function calcHours(
    start?: string, 
    end?: string, 
    options?: { breakMins?: number; breakThresholdHours?: number }
): number {
    if (!start || !end) return 0;
    const [h1, m1] = start.split(':').map(Number);
    const [h2, m2] = end.split(':').map(Number);
    let diff = (h2 * 60 + m2) - (h1 * 60 + m1);
    if (diff < 0) diff += 24 * 60;
    let h = diff / 60;
    
    const threshold = options?.breakThresholdHours ?? 6;
    const breakMins = options?.breakMins !== undefined ? options.breakMins : 30;
    
    if (breakMins > 0 && h >= threshold) {
        h -= (breakMins / 60);
    }
    return Math.max(0, Math.round(h * 10000) / 10000);
}
