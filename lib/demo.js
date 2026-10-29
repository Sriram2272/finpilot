import { addDays } from './schema.js';

// A believable month of spending for an Indian salaried user. Each row is
// [day offset from the 1st, type, amount, category, merchant, paymentMethod, description].
const MONTH_TEMPLATE = [
    [0, 'income', 85000, 'Salary & Income', 'Acme Technologies', 'bank_transfer', 'Monthly salary'],
    [0, 'expense', 22000, 'Rent & Housing', 'Landlord', 'bank_transfer', 'Monthly rent'],
    [1, 'expense', 640, 'Groceries', 'DMart', 'upi', 'Weekly groceries'],
    [2, 'expense', 230, 'Transport', 'Uber', 'upi', 'Ride to office'],
    [2, 'expense', 450, 'Food & Dining', 'Barbeque Nation', 'card', 'Lunch with team'],
    [3, 'expense', 1499, 'Bills & Utilities', 'Airtel', 'upi', 'Broadband bill'],
    [4, 'expense', 649, 'Entertainment', 'Netflix', 'card', 'Netflix subscription'],
    [5, 'expense', 320, 'Food & Dining', "Meghana's", 'upi', 'Dinner'],
    [6, 'expense', 2100, 'Shopping', 'Amazon', 'card', 'Headphones'],
    [7, 'expense', 180, 'Food & Dining', 'Starbucks', 'upi', 'Coffee'],
    [8, 'expense', 870, 'Groceries', 'Blinkit', 'upi', 'Groceries'],
    [9, 'expense', 1850, 'Bills & Utilities', 'BESCOM', 'upi', 'Electricity bill'],
    [10, 'expense', 260, 'Transport', 'Rapido', 'cash', 'Auto ride'],
    [11, 'expense', 540, 'Health', 'Apollo Pharmacy', 'card', 'Medicines'],
    [12, 'expense', 1200, 'Personal Care', 'Toni & Guy', 'card', 'Haircut'],
    [13, 'expense', 380, 'Food & Dining', 'Swiggy', 'upi', 'Biryani order'],
    [14, 'income', 12000, 'Salary & Income', 'Freelance client', 'upi', 'Freelance project'],
    [15, 'expense', 760, 'Groceries', 'BigBasket', 'upi', 'Groceries'],
    [16, 'expense', 3200, 'Travel', 'IRCTC', 'upi', 'Train tickets'],
    [17, 'expense', 499, 'Education', 'Udemy', 'card', 'React course'],
    [18, 'expense', 2500, 'Fuel', 'Indian Oil', 'card', 'Petrol'],
    [19, 'expense', 610, 'Food & Dining', 'Zomato', 'upi', 'Team dinner'],
    [20, 'expense', 1000, 'Gifts & Donations', 'CRY', 'upi', 'Donation'],
    [21, 'expense', 340, 'Transport', 'Namma Metro', 'card', 'Metro card recharge'],
    [22, 'expense', 900, 'Entertainment', 'PVR', 'card', 'Movie night'],
    [23, 'expense', 520, 'Groceries', 'Zepto', 'upi', 'Groceries'],
    [25, 'expense', 1800, 'Shopping', 'Myntra', 'card', 'Shirt'],
    [26, 'expense', 280, 'Food & Dining', 'Chai Point', 'cash', 'Snacks'],
    [27, 'expense', 450, 'Health', 'Cult.fit', 'upi', 'Gym day pass'],
];

const DEMO_LIMITS = { 'Food & Dining': 3000, Groceries: 3500, Transport: 1500, Shopping: 3000, Entertainment: 1500 };

const monthOf = (iso) => iso.slice(0, 7);
const prevMonth = (month) => {
    const [y, m] = month.split('-').map(Number);
    return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};

// Builds demo rows for this month (up to today) and the full previous month.
// Last month is scaled slightly so the "vs last month" comparison is interesting.
function buildDemo(today) {
    const thisMonth = monthOf(today);
    const lastMonth = prevMonth(thisMonth);
    const rows = [];
    for (const [month, scale] of [[lastMonth, 0.88], [thisMonth, 1]]) {
        for (const [i, [day, type, amount, category, merchant, paymentMethod, description]] of MONTH_TEMPLATE.entries()) {
            const date = addDays(`${month}-01`, day);
            if (monthOf(date) !== month || date > today) continue;
            const fixed = type === 'income' || category === 'Rent & Housing';
            rows.push({
                draftId: `demo-${month}-${i}`,
                type,
                amount: fixed ? amount : Math.round(amount * scale),
                currency: 'INR',
                category: category === 'Fuel' ? 'Transport' : category,
                date,
                merchant,
                paymentMethod,
                description,
            });
        }
    }
    const limits = Object.entries(DEMO_LIMITS).map(([category, limit]) => ({ month: thisMonth, category, currency: 'INR', limit }));
    return { rows, limits };
}

export { buildDemo, prevMonth };
