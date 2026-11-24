/**
 * Business types and their optional starter presets.
 * A preset is only a SUGGESTION: starter categories are added when the owner asks for them
 * and existing records are never changed. Prices, stock and VAT are never preset.
 */
export type BusinessPreset = { label: string; categories: string[]; units: string[] };

const GENERIC_UNITS = ["piece", "pack", "box", "kg", "litre"];

export const BUSINESS_PRESETS: Record<string, BusinessPreset> = {
  retail: { label: "General retail", units: GENERIC_UNITS, categories: ["Groceries", "Beverages", "Household", "Toiletries", "Stationery", "Clothing & Shoes", "Electronics", "Other"] },
  electronics: { label: "Electronics & phones", units: ["piece", "set", "box"], categories: ["Phones", "Phone Accessories", "Chargers & Cables", "Audio", "TVs & Displays", "Small Appliances", "Other"] },
  computers: { label: "Computers & IT", units: ["piece", "set", "box", "metre"], categories: ["Laptops", "Desktops", "Printers & Ink", "Networking", "Storage", "Accessories", "Software", "Other"] },
  beauty: { label: "Beauty & cosmetics", units: ["piece", "bottle", "pack", "ml"], categories: ["Skincare", "Hair Care", "Make-up", "Fragrances", "Nails", "Tools & Accessories", "Other"] },
  salon: { label: "Salon & barber", units: ["piece", "bottle", "pack", "ml"], categories: ["Hair Products", "Treatments", "Styling Tools", "Extensions & Weaves", "Consumables", "Other"] },
  pharmacy: { label: "Pharmacy", units: ["piece", "strip", "bottle", "box", "pack"], categories: ["Over-the-counter", "Vitamins & Supplements", "First Aid", "Baby Care", "Personal Care", "Medical Devices", "Other"] },
  stationery: { label: "Stationery", units: ["piece", "pack", "ream", "box", "dozen"], categories: ["Paper & Books", "Writing", "Office Supplies", "School Supplies", "Art & Craft", "Printing", "Other"] },
  agriculture: { label: "Agrovet & farm supplies", units: ["kg", "bag", "litre", "piece", "packet"], categories: ["Seeds", "Fertilizers", "Pesticides & Herbicides", "Animal Feeds", "Veterinary Drugs", "Farm Tools", "Other"] },
  spare_parts: { label: "Spare parts", units: ["piece", "set", "litre", "box"], categories: ["Engine Parts", "Brakes", "Filters", "Electrical", "Suspension", "Lubricants & Fluids", "Tyres & Batteries", "Other"] },
  hardware: { label: "Hardware", units: ["piece", "kg", "metre", "litre", "roll", "box"], categories: ["Tools", "Plumbing", "Electrical", "Paint & Finishes", "Nails, Screws & Fasteners", "Locks & Hinges", "Safety Gear", "Other"] },
  building_materials: { label: "Building materials", units: ["bag", "piece", "tonne", "metre", "sheet", "lorry"], categories: ["Cement & Aggregates", "Steel & Iron Sheets", "Blocks & Bricks", "Roofing", "Doors & Windows", "Tiles & Flooring", "Plumbing", "Other"] },
  timber: { label: "Timber & wood", units: ["piece", "foot", "metre", "sheet"], categories: ["Timber", "Plywood & Boards", "Mouldings", "Fasteners", "Varnish & Finishes", "Other"] },
  furniture: { label: "Furniture", units: ["piece", "set"], categories: ["Beds & Mattresses", "Sofas & Seating", "Tables", "Wardrobes & Storage", "Office Furniture", "Fittings & Accessories", "Other"] },
  wholesale: { label: "Wholesale", units: ["carton", "bag", "kg", "dozen", "piece"], categories: ["Beverages", "Cooking Oils & Fats", "Flour & Grains", "Sugar & Sweeteners", "Household Goods", "Toiletries", "Packaging", "Other"] },
  hotel: { label: "Hotel & guest house", units: ["plate", "portion", "cup", "glass", "bottle", "piece"], categories: ["Breakfast", "Starters", "Mains", "Sides", "Desserts", "Hot Drinks", "Soft Drinks", "Beer, Wine & Spirits", "Room Service", "Other"] },
  restaurant: { label: "Restaurant & cafe", units: ["plate", "portion", "cup", "glass", "bottle", "piece"], categories: ["Breakfast", "Starters", "Mains", "Sides", "Desserts", "Hot Drinks", "Soft Drinks", "Beer, Wine & Spirits", "Other"] },
  general: { label: "General", units: GENERIC_UNITS, categories: ["General"] },
  other: { label: "Other", units: GENERIC_UNITS, categories: ["General"] },
};

export const BUSINESS_TYPES = Object.keys(BUSINESS_PRESETS);

export function presetFor(businessType: string): BusinessPreset {
  return BUSINESS_PRESETS[businessType] ?? BUSINESS_PRESETS.other!;
}
