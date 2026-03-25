const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Mock window and LG_RUNTIME_CONFIG
const mockWindow = {
    LG_RUNTIME_CONFIG: {
        RANKS: ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'],
        RED_SUITS: new Set(['♥', '♦']),
        DECK_COLORS: [
            { primary: '#B8453A', symbol: '●' },
            { primary: '#4A7C96', symbol: '◆' },
            { primary: '#6B7F4E', symbol: '▲' },
        ]
    },
    document: {
        getElementById: () => null,
        querySelectorAll: () => []
    },
    crypto: {
        randomUUID: () => 'test-uuid'
    }
};

// Load the script
const scriptPath = path.resolve(__dirname, '../scripts/runtime-utils.js');
const scriptContent = fs.readFileSync(scriptPath, 'utf8');

// Execute the script with mockWindow as the global "window"
const context = vm.createContext({ window: mockWindow });
vm.runInContext(scriptContent, context);

const { LG_RUNTIME_UTILS } = mockWindow;
const { sortCards } = LG_RUNTIME_UTILS;

// Helper to check deep equality because node:test output was confusing
function assertDeep(actual, expected, message) {
    assert.strictEqual(JSON.stringify(actual), JSON.stringify(expected), message);
}

test('sortCards - basic sorting by rank', (t) => {
    const cards = [
        { rank: 'K', deck: 0 },
        { rank: 'A', deck: 0 },
        { rank: '5', deck: 0 },
        { rank: 'JOKER', deck: 0 },
        { rank: '10', deck: 0 },
    ];
    const sorted = sortCards(cards);
    const ranks = sorted.map(c => c.rank);
    assertDeep(ranks, ['A', '5', '10', 'K', 'JOKER']);
});

test('sortCards - sorting by deck for identical ranks', (t) => {
    const cards = [
        { rank: 'A', deck: 1 },
        { rank: 'A', deck: 0 },
        { rank: 'A', deck: 2 },
    ];
    const sorted = sortCards(cards);
    const decks = sorted.map(c => c.deck);
    assertDeep(decks, [0, 1, 2]);
});

test('sortCards - complex mixed case', (t) => {
    const cards = [
        { rank: 'JOKER', deck: 1 },
        { rank: '2', deck: 0 },
        { rank: 'JOKER', deck: 0 },
        { rank: 'A', deck: 0 },
        { rank: '2', deck: 1 },
    ];
    const sorted = sortCards(cards);
    assertDeep(sorted, [
        { rank: 'A', deck: 0 },
        { rank: '2', deck: 0 },
        { rank: '2', deck: 1 },
        { rank: 'JOKER', deck: 0 },
        { rank: 'JOKER', deck: 1 },
    ]);
});

test('sortCards - unknown rank handling', (t) => {
    // RANKS indices are 0 to 12. 50 is after K (12) but before JOKER (99).
    const cards = [
        { rank: 'JOKER', deck: 0 },
        { rank: 'UNKNOWN', deck: 0 },
        { rank: 'A', deck: 0 },
    ];
    const sorted = sortCards(cards);
    assertDeep(sorted.map(c => c.rank), ['A', 'UNKNOWN', 'JOKER']);
});

test('sortCards - immutability', (t) => {
    const cards = [
        { rank: 'K', deck: 0 },
        { rank: 'A', deck: 0 },
    ];
    const cardsCopy = JSON.parse(JSON.stringify(cards));
    sortCards(cards);
    assertDeep(cards, cardsCopy, 'Original array should not be modified');
});
