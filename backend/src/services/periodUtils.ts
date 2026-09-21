export function getFortnightStart(d: Date | string): Date {
    let utcDate: Date;
    if (typeof d === 'string') {
        const parts = d.split('T')[0].split('-');
        if (parts.length === 3) {
            utcDate = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
        } else {
            const dt = new Date(d);
            utcDate = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
        }
    } else {
        utcDate = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    }
    // Reference Sunday: March 29, 2026 UTC
    const ref = new Date(Date.UTC(2026, 2, 29));
    const diffDays = Math.floor((utcDate.getTime() - ref.getTime()) / 86400000);
    const offset = Math.floor(diffDays / 14);
    return new Date(ref.getTime() + offset * 14 * 86400000);
}

export function getFortnightStartIso(d: Date | string): string {
    return fmtISO(getFortnightStart(d));
}

export function addDays(d: Date, n: number): Date {
    const r = new Date(d.getTime());
    r.setUTCDate(r.getUTCDate() + n);
    return r;
}

export function fmtISO(d: Date): string {
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}


const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is string {
    if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
    const [y, m, d] = value.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** True when `value` is the first day of a pay period (so a client cannot address a shifted "period"). */
export function isFortnightStart(value: unknown): value is string {
    return isIsoDate(value) && getFortnightStartIso(value) === value;
}

export function parseIsoDateUtc(value: string): Date {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
}
