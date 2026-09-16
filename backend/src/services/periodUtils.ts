export function getFortnightStart(d: Date | string): Date {
    const dt = typeof d === 'string' ? new Date(d) : new Date(d);
    // Use UTC date numbers to construct a UTC start of day
    const utcDate = new Date(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()));
    // Reference Sunday: March 29, 2026 UTC
    const ref = new Date(Date.UTC(2026, 2, 29));
    const diffDays = Math.floor((utcDate.getTime() - ref.getTime()) / 86400000);
    const offset = Math.floor(diffDays / 14);
    return new Date(ref.getTime() + offset * 14 * 86400000);
}

export function addDays(d: Date, n: number): Date {
    const r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
}

export function fmtISO(d: Date): string {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
