import type { ItemTemplate } from './packing';

const personal = (id: string, nameKey: string, unitKey = 'unit.items', quantityPerPerson = 1): ItemTemplate => ({ id, nameKey, category: 'General', type: 'personal', quantityRule: 'per_person', quantityPerPerson, unitKey });
const fixed = (id: string, nameKey: string): ItemTemplate => ({ id, nameKey, category: 'General', type: 'shared', quantityRule: 'fixed', fixedQuantity: 1, unitKey: 'unit.items' });
const capacity = (id: string, nameKey: string, capacityPerItem: number, unitKey = 'unit.items'): ItemTemplate => ({ id, nameKey, category: 'General', type: 'shared', quantityRule: 'capacity', capacityPerItem, unitKey });
const water = personal('water-bottle', 'Water bottle');
const aid = fixed('first-aid', 'First aid kit');
export const packingTemplates: Record<string, ItemTemplate[]> = {
  'Domestic travel': [personal('clothes', 'Clothes', 'unit.sets'), personal('towel', 'Towel', 'unit.sheets', 2), water, personal('phone-charger', 'Phone charger'), personal('medication', 'Medication'), aid],
  Other: [water, personal('clothes', 'Clothes', 'unit.sets'), personal('phone-charger', 'Phone charger'), aid],
  Camping: [capacity('tent', 'Tent', 3), personal('sleeping-bag', 'Sleeping bag'), personal('sleeping-mat', 'Sleeping mat'), water, personal('headlamp', 'Headlamp'), personal('rain-jacket', 'Rain jacket'), aid, fixed('lantern', 'Lantern'), capacity('cooking-set', 'Cooking set', 4, 'unit.sets'), fixed('trash-bags', 'Trash bags')],
  Hiking: [personal('hiking-shoes', 'Hiking shoes', 'unit.pairs'), water, personal('trail-snacks', 'Trail snacks'), personal('rain-jacket', 'Rain jacket'), personal('headlamp', 'Headlamp'), personal('warm-layer', 'Warm layer'), aid, fixed('map', 'Map / offline map')],
  Beach: [personal('swimwear', 'Swimwear'), personal('towel', 'Towel', 'unit.sheets', 2), personal('sunscreen', 'Sunscreen'), personal('sunglasses', 'Sunglasses', 'unit.pairs'), water, personal('sandals', 'Sandals', 'unit.pairs'), personal('change-clothes', 'Change of clothes', 'unit.sets'), aid],
  'Overseas travel': [personal('passport', 'Passport'), personal('flight-tickets', 'Flight tickets'), personal('wallet', 'Wallet'), personal('phone-charger', 'Phone charger'), personal('travel-adapter', 'Travel adapter'), personal('clothes', 'Clothes', 'unit.sets'), personal('toiletries', 'Toiletries', 'unit.sets'), personal('medication', 'Medication'), personal('insurance', 'Travel insurance details')],
  'School event': [personal('student-id', 'Student ID'), personal('notebook', 'Notebook'), personal('pens', 'Pens'), personal('laptop', 'Laptop'), personal('charger', 'Charger'), water, personal('lunch', 'Lunch'), personal('umbrella', 'Umbrella'), aid],
};
