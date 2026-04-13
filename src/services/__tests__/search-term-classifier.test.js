/**
 * Test suite for search term classifier
 * Validates business logic for recommendation generation
 * Based on Amazon SP API metrics: purchases14d, clicks, cost, acosClicks14d
 */

import { classifySearchTerms } from '../search-term-classifier.js';

describe('classifySearchTerms', () => {
  describe('SCALE_UP recommendations', () => {
    it('should recommend SCALE_UP for converting, efficient terms (purchases >= 1, ACoS < 25%)', () => {
      const records = [
        { searchTerm: 'leather wallet', purchases14d: 5, acosClicks14d: 15, clicks: 50, cost: 10 },
      ];
      const result = classifySearchTerms(records);
      expect(result[0].recommendation).toBe('SCALE_UP');
    });

    it('should require purchases >= 1 for SCALE_UP', () => {
      const records = [
        { searchTerm: 'no conversions', purchases14d: 0, acosClicks14d: 15, clicks: 50, cost: 10 },
      ];
      const result = classifySearchTerms(records);
      expect(result[0].recommendation).not.toBe('SCALE_UP');
    });

    it('should require ACoS < 25% for SCALE_UP', () => {
      const records = [
        { searchTerm: 'low roi', purchases14d: 3, acosClicks14d: 35, clicks: 50, cost: 10 },
      ];
      const result = classifySearchTerms(records);
      expect(result[0].recommendation).not.toBe('SCALE_UP');
    });

    it('should match ACoS boundary conditions (threshold 25%)', () => {
      const boundaryRecords = [
        { searchTerm: 'term1', purchases14d: 2, acosClicks14d: 24.99, clicks: 20, cost: 5 },
        { searchTerm: 'term2', purchases14d: 2, acosClicks14d: 25.00, clicks: 20, cost: 5 },
        { searchTerm: 'term3', purchases14d: 2, acosClicks14d: 25.01, clicks: 20, cost: 5 },
      ];
      const result = classifySearchTerms(boundaryRecords);
      expect(result[0].recommendation).toBe('SCALE_UP');
      expect(result[1].recommendation).not.toBe('SCALE_UP');
      expect(result[2].recommendation).not.toBe('SCALE_UP');
    });
  });

  describe('ADD_NEGATIVE recommendations', () => {
    it('should recommend ADD_NEGATIVE for wasted spend (clicks >= 10, purchases = 0, cost > $5)', () => {
      const records = [
        { searchTerm: 'free shipping coupon', purchases14d: 0, clicks: 15, cost: 8 },
      ];
      const result = classifySearchTerms(records);
      expect(result[0].recommendation).toBe('ADD_NEGATIVE');
    });

    it('should require clicks >= 10 for ADD_NEGATIVE', () => {
      const records = [
        { searchTerm: 'low clicks no sales', purchases14d: 0, clicks: 5, cost: 10 },
      ];
      const result = classifySearchTerms(records);
      expect(result[0].recommendation).not.toBe('ADD_NEGATIVE');
    });

    it('should require cost > $5 for ADD_NEGATIVE', () => {
      const records = [
        { searchTerm: 'cheap wasted spend', purchases14d: 0, clicks: 15, cost: 3 },
      ];
      const result = classifySearchTerms(records);
      expect(result[0].recommendation).not.toBe('ADD_NEGATIVE');
    });
  });

  describe('ADD_EXACT recommendations', () => {
    it('should recommend ADD_EXACT for converting but inefficient terms (purchases >= 1, ACoS 25-39%)', () => {
      const records = [
        { searchTerm: 'leather wallet mens', purchases14d: 3, acosClicks14d: 32, clicks: 30, cost: 15 },
      ];
      const result = classifySearchTerms(records);
      expect(result[0].recommendation).toBe('ADD_EXACT');
    });

    it('should require purchases >= 1 for ADD_EXACT', () => {
      const records = [
        { searchTerm: 'no sales high acos', purchases14d: 0, acosClicks14d: 32, clicks: 30, cost: 15 },
      ];
      const result = classifySearchTerms(records);
      expect(result[0].recommendation).not.toBe('ADD_EXACT');
    });

    it('should match ACoS boundary conditions (25-39% range)', () => {
      const boundaryRecords = [
        { searchTerm: 'term1', purchases14d: 2, acosClicks14d: 24.99, clicks: 20, cost: 5 },
        { searchTerm: 'term2', purchases14d: 2, acosClicks14d: 25.00, clicks: 20, cost: 5 },
        { searchTerm: 'term3', purchases14d: 2, acosClicks14d: 39.99, clicks: 20, cost: 5 },
        { searchTerm: 'term4', purchases14d: 2, acosClicks14d: 40.00, clicks: 20, cost: 5 },
      ];
      const result = classifySearchTerms(boundaryRecords);
      expect(result[0].recommendation).not.toBe('ADD_EXACT');
      expect(result[1].recommendation).toBe('ADD_EXACT');
      expect(result[2].recommendation).toBe('ADD_EXACT');
      expect(result[3].recommendation).not.toBe('ADD_EXACT');
    });
  });

  describe('WATCH recommendations', () => {
    it('should recommend WATCH for insufficient data', () => {
      const records = [
        { searchTerm: 'new emerging term', purchases14d: 0, clicks: 2, cost: 0.50 },
      ];
      const result = classifySearchTerms(records);
      expect(result[0].recommendation).toBe('WATCH');
    });

    it('should apply to terms that do not match other criteria', () => {
      const records = [
        { searchTerm: 'seasonal niche', purchases14d: 1, acosClicks14d: 45, clicks: 8, cost: 3 },
      ];
      const result = classifySearchTerms(records);
      expect(result[0].recommendation).toBe('WATCH');
    });
  });

  describe('batch processing', () => {
    it('should classify multiple terms correctly', () => {
      const records = [
        { searchTerm: 'scale up candidate', purchases14d: 4, acosClicks14d: 20, clicks: 40, cost: 12 },
        { searchTerm: 'wasted spend', purchases14d: 0, clicks: 20, cost: 8 },
        { searchTerm: 'add exact candidate', purchases14d: 2, acosClicks14d: 30, clicks: 25, cost: 10 },
        { searchTerm: 'emerging trend', purchases14d: 0, clicks: 5, cost: 2 },
      ];
      const result = classifySearchTerms(records);

      expect(result).toHaveLength(4);
      expect(result[0].recommendation).toBe('SCALE_UP');
      expect(result[1].recommendation).toBe('ADD_NEGATIVE');
      expect(result[2].recommendation).toBe('ADD_EXACT');
      expect(result[3].recommendation).toBe('WATCH');
    });

    it('should preserve original search term in output', () => {
      const records = [
        { searchTerm: 'test term 1', purchases14d: 2, acosClicks14d: 20, clicks: 20, cost: 5 },
        { searchTerm: 'test term 2', purchases14d: 0, clicks: 2, cost: 1 },
      ];
      const result = classifySearchTerms(records);

      expect(result[0].searchTerm).toBe('test term 1');
      expect(result[1].searchTerm).toBe('test term 2');
    });
  });

  describe('edge cases', () => {
    it('should handle empty array', () => {
      const result = classifySearchTerms([]);
      expect(result).toEqual([]);
    });

    it('should handle zero values', () => {
      const records = [
        { searchTerm: 'no data', purchases14d: 0, clicks: 0, cost: 0 },
      ];
      const result = classifySearchTerms(records);
      expect(result[0].recommendation).toBeDefined();
    });

    it('should handle very high values', () => {
      const records = [
        { searchTerm: 'viral term', purchases14d: 100, acosClicks14d: 5, clicks: 1000, cost: 100 },
      ];
      const result = classifySearchTerms(records);
      expect(result[0].recommendation).toBeDefined();
    });

    it('should handle missing properties gracefully', () => {
      const records = [
        { searchTerm: 'incomplete data' },
      ];
      // Should not throw, should handle undefined purchases/clicks/cost/acos
      expect(() => classifySearchTerms(records)).not.toThrow();
    });

    it('should handle null/undefined metrics', () => {
      const records = [
        { searchTerm: 'null metrics', purchases14d: null, clicks: undefined, cost: null, acosClicks14d: undefined },
      ];
      const result = classifySearchTerms(records);
      expect(result[0].recommendation).toBe('WATCH');
    });
  });

  describe('consistency', () => {
    it('should produce same results for same input', () => {
      const records = [
        { searchTerm: 'consistent term', purchases14d: 2, acosClicks14d: 22, clicks: 20, cost: 5 },
      ];
      const result1 = classifySearchTerms(records);
      const result2 = classifySearchTerms(records);

      expect(result1[0].recommendation).toBe(result2[0].recommendation);
    });

    it('should not mutate input records', () => {
      const records = [
        { searchTerm: 'test', purchases14d: 2, acosClicks14d: 20, clicks: 20, cost: 5 },
      ];
      const originalJSON = JSON.stringify(records);

      classifySearchTerms(records);

      expect(JSON.stringify(records)).toBe(originalJSON);
    });
  });
});
