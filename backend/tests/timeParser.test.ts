import { parseSmartTime } from '../src/services/timeParser';

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
        
        it('should handle periods and decimal hours', () => {
            expect(parseSmartTime('9.30')).toBe('09:30');
            expect(parseSmartTime('17.30')).toBe('17:30');
            expect(parseSmartTime('9.5')).toBe('09:30');
            expect(parseSmartTime('9.5pm')).toBe('21:30');
            expect(parseSmartTime('9.25')).toBe('09:15');
            expect(parseSmartTime('9.00')).toBe('09:00');
        });

        it('should handle SQL TIME and ISO strings with seconds', () => {
            expect(parseSmartTime('09:00:00')).toBe('09:00');
            expect(parseSmartTime('17:30:00.0000')).toBe('17:30');
        });
        
        it('should handle edge cases and invalid input', () => {
            expect(parseSmartTime('')).toBe('');
            expect(parseSmartTime('invalid')).toBe('');
        });
    });
});
