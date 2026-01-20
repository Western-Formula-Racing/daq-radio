import { describe, it, expect } from 'vitest';

/**
 * Parse the physValue string from Candied (format: "123.45 voltage:V")
 * This is a copy of the internal function for testing purposes
 */
function parsePhysValue(physValue: string): { value: number; unit: string } {
    const parts = physValue.trim().split(" ");
    const value = parseFloat(parts[0]);

    let unit = "";
    if (parts.length > 1) {
        const unitPart = parts.slice(1).join(" ");
        const colonIndex = unitPart.indexOf(":");
        if (colonIndex !== -1) {
            unit = unitPart.substring(colonIndex + 1);
        }
    }

    return { value, unit };
}

describe('parsePhysValue', () => {
    it('should parse value with unit', () => {
        const result = parsePhysValue('123.45 voltage:V');
        expect(result.value).toBe(123.45);
        expect(result.unit).toBe('V');
    });

    it('should parse value without unit', () => {
        const result = parsePhysValue('42');
        expect(result.value).toBe(42);
        expect(result.unit).toBe('');
    });

    it('should parse value with complex unit', () => {
        const result = parsePhysValue('98.6 temperature:deg/s');
        expect(result.value).toBe(98.6);
        expect(result.unit).toBe('deg/s');
    });

    it('should parse negative values', () => {
        const result = parsePhysValue('-15.5 current:A');
        expect(result.value).toBe(-15.5);
        expect(result.unit).toBe('A');
    });

    it('should parse zero', () => {
        const result = parsePhysValue('0 power:W');
        expect(result.value).toBe(0);
        expect(result.unit).toBe('W');
    });

    it('should handle extra whitespace', () => {
        const result = parsePhysValue('  100.5   voltage:V  ');
        expect(result.value).toBe(100.5);
        expect(result.unit).toBe('V'); // Whitespace after colon is included in unit
    });

    it('should parse percentage unit', () => {
        const result = parsePhysValue('75.5 percentage:%');
        expect(result.value).toBe(75.5);
        expect(result.unit).toBe('%');
    });

    it('should parse bar unit', () => {
        const result = parsePhysValue('150.2 pressure:bar');
        expect(result.value).toBe(150.2);
        expect(result.unit).toBe('bar');
    });

    it('should parse rpm unit', () => {
        const result = parsePhysValue('5000 speed:rpm');
        expect(result.value).toBe(5000);
        expect(result.unit).toBe('rpm');
    });

    it('should parse degree unit', () => {
        const result = parsePhysValue('-45.3 angle:deg');
        expect(result.value).toBe(-45.3);
        expect(result.unit).toBe('deg');
    });

    it('should handle scientific notation', () => {
        const result = parsePhysValue('1.23e-4 value:m');
        expect(result.value).toBe(0.000123);
        expect(result.unit).toBe('m');
    });

    it('should handle value with no unit descriptor', () => {
        const result = parsePhysValue('42 nounit');
        expect(result.value).toBe(42);
        expect(result.unit).toBe(''); // No colon, so no unit
    });
});
