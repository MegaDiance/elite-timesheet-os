import { parseSmartTime, calcHours } from '../src/services/timeParser';

describe('timeParser', () => {
    describe('parseSmartTime', () => {
        it('should parse simple military time', () => {
            expect(parseSmartTime('0900')).toBe('09:00');
            expect(parseSmartTime('1700')).toBe('17:00');
            expect(parseSmartTime('9')).toBe('09:00');
        });

        it('should parse am/pm times', () => {
            expect(parseSmartTime('9am')).toBe('09:00');
            expect(parseSmartTime('9pm')).toBe('21:00');
            expect(parseSmartTime('5pm')).toBe('17:00');
            expect(parseSmartTime('12pm')).toBe('12:00');
            expect(parseSmartTime('12am')).toBe('00:00');
        });

        it('should handle colons', () => {
            expect(parseSmartTime('09:30')).toBe('09:30');
            expect(parseSmartTime('5:30pm')).toBe('17:30');
        });
        
        it('should handle edge cases and invalid input', () => {
            expect(parseSmartTime('')).toBe('');
            expect(parseSmartTime('invalid')).toBe('');
        });
    });

    describe('calcHours', () => {
        it('should calculate basic hours without lunch break', () => {
            expect(calcHours('09:00', '13:00')).toBe(4);
        });

        it('should calculate hours with 0.5 lunch break for shifts >= 6 hours', () => {
            expect(calcHours('09:00', '17:00')).toBe(7.5);
            expect(calcHours('08:30', '16:30')).toBe(7.5);
        });

        it('should handle overnight shifts (crossing midnight)', () => {
            expect(calcHours('22:00', '02:00')).toBe(4);
            expect(calcHours('20:00', '06:00')).toBe(9.5); // 10 hrs - 0.5 break
        });
    });
});
