export function parseSmartTime(val?: string): string {
    if (!val) return '';
    let t = val.trim().toLowerCase().replace(/\s/g, '');
    if (!t) return '';

    // If it's standard ISO or SQL TIME like "09:00:00" or "09:00:00.0000"
    if (/^\d{2}:\d{2}:\d{2}/.test(t)) {
        return t.substring(0, 5);
    }
    if (/^\d{2}:\d{2}$/.test(t)) {
        return t;
    }

    let isPM = t.includes('p') || t.includes('pm');
    let isAM = t.includes('a') || t.includes('am');

    // Handle periods/dots: e.g. 9.30 (9:30), 9.5 (9:30), 9.00 (9:00)
    if (t.includes('.')) {
        const dotParts = t.replace(/[^\d.]/g, '').split('.');
        const hoursNum = parseInt(dotParts[0], 10) || 0;
        const decStr = dotParts[1] || '';
        
        let mins = 0;
        if (decStr.length === 1) {
            // e.g. .5 -> 30 mins
            mins = Math.round(Number('0.' + decStr) * 60);
        } else if (decStr === '25') {
            mins = 15;
        } else if (decStr === '50') {
            mins = 30;
        } else if (decStr === '75') {
            mins = 45;
        } else {
            mins = parseInt(decStr.substring(0, 2), 10) || 0;
        }

        let h = hoursNum;
        if (isPM && h < 12) h += 12;
        if (isAM && h === 12) h = 0;
        if (h > 23) h = 23;
        if (mins > 59) mins = 59;
        return String(h).padStart(2, '0') + ':' + String(mins).padStart(2, '0');
    }

    t = t.replace(/[^\d:]/g, '');
    if (!t) return '';
    
    let h = 0, m = 0;
    if (t.includes(':')) {
        const parts = t.split(':');
        h = parseInt(parts[0], 10) || 0;
        m = parseInt(parts[1], 10) || 0;
    } else {
        if (t.length <= 2) {
            h = parseInt(t, 10);
            m = 0;
        } else if (t.length === 3) {
            h = parseInt(t.substring(0, 1), 10);
            m = parseInt(t.substring(1), 10);
        } else if (t.length >= 4) {
            h = parseInt(t.substring(0, 2), 10);
            m = parseInt(t.substring(2, 4), 10);
        }
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
    let diff = (h2 * 60 + (m2 || 0)) - (h1 * 60 + (m1 || 0));
    if (diff < 0) diff += 24 * 60;
    let h = diff / 60;
    
    const threshold = options?.breakThresholdHours ?? 6;
    const breakMins = options?.breakMins !== undefined ? options.breakMins : 30;
    
    if (breakMins > 0 && h >= threshold) {
        h -= (breakMins / 60);
    }
    return Math.max(0, Math.round(h * 100) / 100);
}
