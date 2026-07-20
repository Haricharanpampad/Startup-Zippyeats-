const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

const app = express();

// 1. Explicitly allow CORS for Express (HTTP)
app.use(cors({ origin: '*' })); 
app.use(express.json());

const server = http.createServer(app);

// 2. Explicitly allow CORS for Socket.io (WebSockets)
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// =======================================================
// 🗄️ IN-MEMORY DATASET & RESILIENT DATABASE MOCK
// =======================================================
const users = [
    {
        id: "mock-user-id",
        name: "Alex Driver",
        email: "alex@traveler.com",
        password: "$2a$10$7zB3rTeeW/eXmFvC0w.6n.I6mS6/6x1Z7r3V4j9M1Y5W7g8b9cOaG", // hashed password for "password" using bcryptjs
        phone: "+1-555-0199"
    }
];

const restaurants = [
    {
        id: "f82e4f22-3816-4243-9a15-e642b8c2a0c0",
        name: "Pitstop Highway Diner",
        address: "456 Interstate Route 95, Exit 12",
        latitude: 40.7128,
        longitude: -74.0060,
        average_prep_time: 15,
        is_active: true,
        email: "diner@pitstop.com",
        password: "password"
    },
    {
        id: "1b1df56c-9f3f-4c12-9332-58144aa5b7f2",
        name: "Kitchen Live Diner",
        address: "789 Highway Avenue",
        latitude: 40.7306,
        longitude: -73.9352,
        average_prep_time: 10,
        is_active: true,
        email: "kitchen@live.com",
        password: "password"
    }
];

const menu_items = [
    {
        id: "item-burger",
        restaurant_id: "f82e4f22-3816-4243-9a15-e642b8c2a0c0",
        name: "Classic Trucker Burger",
        description: "Juicy beef patty with cheddar cheese, lettuce, and secret sauce. Comes with fries.",
        price: 14.99,
        is_available: true
    },
    {
        id: "item-coffee",
        restaurant_id: "f82e4f22-3816-4243-9a15-e642b8c2a0c0",
        name: "Roadtrip Iced Coffee",
        description: "Freshly brewed cold brew over ice with vanilla sweet cream.",
        price: 4.50,
        is_available: true
    },
    {
        id: "item-burger-2",
        restaurant_id: "1b1df56c-9f3f-4c12-9332-58144aa5b7f2",
        name: "Classic Trucker Burger",
        description: "Juicy beef patty with cheddar cheese, lettuce, and secret sauce. Comes with fries.",
        price: 14.99,
        is_available: true
    },
    {
        id: "item-coffee-2",
        restaurant_id: "1b1df56c-9f3f-4c12-9332-58144aa5b7f2",
        name: "Roadtrip Iced Coffee",
        description: "Freshly brewed cold brew over ice with vanilla sweet cream.",
        price: 4.50,
        is_available: true
    }
];

const orders = [];
const order_items = [];

// Restaurant Tables State
const tables = [
    { id: "table-d1", restaurant_id: "f82e4f22-3816-4243-9a15-e642b8c2a0c0", table_number: "Table 1", capacity: 4, is_available: true },
    { id: "table-d2", restaurant_id: "f82e4f22-3816-4243-9a15-e642b8c2a0c0", table_number: "Table 2", capacity: 2, is_available: false },
    { id: "table-d3", restaurant_id: "f82e4f22-3816-4243-9a15-e642b8c2a0c0", table_number: "Table 3", capacity: 6, is_available: true },
    { id: "table-k1", restaurant_id: "1b1df56c-9f3f-4c12-9332-58144aa5b7f2", table_number: "Table A", capacity: 4, is_available: true },
    { id: "table-k2", restaurant_id: "1b1df56c-9f3f-4c12-9332-58144aa5b7f2", table_number: "Table B", capacity: 4, is_available: true }
];

// Persistent File Storage Mock Layer
const fs = require('fs');
const path = require('path');
const MOCK_DB_PATH = path.join(__dirname, 'db-mock.json');

function saveMockDb() {
    try {
        const data = {
            users,
            restaurants,
            menu_items,
            orders,
            order_items,
            tables
        };
        fs.writeFileSync(MOCK_DB_PATH, JSON.stringify(data, null, 2), 'utf8');
        console.log("💾 Mock database saved to disk at " + MOCK_DB_PATH);
    } catch (e) {
        console.error("❌ Failed to save mock DB:", e);
    }
}

function loadMockDb() {
    try {
        if (fs.existsSync(MOCK_DB_PATH)) {
            const raw = fs.readFileSync(MOCK_DB_PATH, 'utf8');
            const data = JSON.parse(raw);
            
            if (data.users && data.users.length > 0) {
                users.length = 0;
                users.push(...data.users);
            }
            if (data.restaurants && data.restaurants.length > 0) {
                restaurants.length = 0;
                restaurants.push(...data.restaurants);
            }
            if (data.menu_items && data.menu_items.length > 0) {
                menu_items.length = 0;
                menu_items.push(...data.menu_items);
            }
            if (data.orders && data.orders.length > 0) {
                orders.length = 0;
                orders.push(...data.orders);
            }
            if (data.order_items && data.order_items.length > 0) {
                order_items.length = 0;
                order_items.push(...data.order_items);
            }
            if (data.tables && data.tables.length > 0) {
                tables.length = 0;
                tables.push(...data.tables);
            }
            console.log("📂 Mock database loaded from disk successfully. Found " + restaurants.length + " restaurants.");
        } else {
            saveMockDb();
        }
    } catch (e) {
        console.error("Failed to load mock DB:", e);
    }
}

// Perform initial load of mock database
loadMockDb();

// Ensure a mock simulation order exists in database and memory
async function ensureOrderExists(order_id) {
    if (!order_id || !order_id.startsWith('order-')) return;
    
    // Check in memory first
    let memOrder = orders.find(o => o.id === order_id);
    if (!memOrder) {
        const defaultRestId = "f82e4f22-3816-4243-9a15-e642b8c2a0c0"; // Pitstop Highway Diner
        memOrder = {
            id: order_id,
            user_id: "mock-user-id",
            restaurant_id: defaultRestId,
            total_amount: 19.49,
            fulfillment_type: "PICKUP",
            current_driver_eta: new Date(Date.now() + 30 * 60 * 1000),
            scheduled_fire_time: new Date(Date.now() + 15 * 60 * 1000),
            order_status: "PLACED",
            table_id: null
        };
        orders.push(memOrder);
        
        // Add items to memory order_items
        order_items.push(
            { order_id: order_id, menu_item_id: "item-burger", quantity: 1, price_at_purchase: 14.99 },
            { order_id: order_id, menu_item_id: "item-coffee", quantity: 1, price_at_purchase: 4.50 }
        );
        
        // Also check/insert into DB if Postgres is connected
        if (process.env.DATABASE_URL && !isLocalhostDb) {
            try {
                await pool.query(
                    `INSERT INTO orders (id, user_id, restaurant_id, total_amount, fulfillment_type, current_driver_eta, scheduled_fire_time, order_status)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                     ON CONFLICT DO NOTHING`,
                    [order_id, "mock-user-id", defaultRestId, 19.49, "PICKUP", new Date(Date.now() + 30 * 60 * 1000), new Date(Date.now() + 15 * 60 * 1000), "PLACED"]
                );
                
                await pool.query(
                    `INSERT INTO order_items (order_id, menu_item_id, quantity, price_at_purchase)
                     VALUES ($1, $2, $3, $4), ($1, $5, $6, $7)
                     ON CONFLICT DO NOTHING`,
                    [order_id, "item-burger", 1, 14.99, "item-coffee", 1, 4.50]
                );
            } catch (pgErr) {
                console.error("Failed to insert auto-created order to PG, relying on memory:", pgErr.message);
            }
        }
        
        saveMockDb();
        console.log(`✨ Dynamically auto-created missing simulation order: ${order_id}`);
    }
}

class MockPool {
    constructor() {}
    connect(cb) {
        if (cb) {
            cb(null, this, () => {});
        } else {
            return Promise.resolve(this);
        }
    }
    release() {}
    async query(sql, params = []) {
        const normalizedSql = sql.replace(/\s+/g, ' ').trim();
        
        if (normalizedSql === 'BEGIN' || normalizedSql === 'COMMIT' || normalizedSql === 'ROLLBACK') {
            return { rows: [] };
        }
        
        if (normalizedSql.includes("UPDATE orders SET order_status = 'PREPARING'")) {
            const now = new Date();
            const matchedOrders = orders.filter(o => o.order_status === 'PLACED' && now >= new Date(o.scheduled_fire_time));
            matchedOrders.forEach(o => o.order_status = 'PREPARING');
            if (matchedOrders.length > 0) {
                saveMockDb();
            }
            return { rows: matchedOrders };
        }
        
        if (normalizedSql.includes('INSERT INTO users')) {
            const [name, email, password, phone] = params;
            if (users.some(u => u.email === email)) {
                const err = new Error('Unique violation');
                err.code = '23505';
                throw err;
            }
            const newUser = { id: 'user-' + Date.now(), name, email, password, phone };
            users.push(newUser);
            saveMockDb();
            return { rows: [newUser] };
        }
        
        if (normalizedSql.includes('FROM users WHERE email =')) {
            const email = params[0];
            const user = users.find(u => u.email === email);
            return { rows: user ? [user] : [] };
        }
        
        if (normalizedSql.includes('INSERT INTO restaurants')) {
            const [name, address, latitude, longitude, email, password] = params;
            const id = 'rest-' + Date.now();
            restaurants.push({ id, name, address, latitude: parseFloat(latitude), longitude: parseFloat(longitude), email, password, average_prep_time: 15, is_active: true });
            saveMockDb();
            return { rows: [{ id }] };
        }
        
        if (normalizedSql.includes('FROM restaurants WHERE email =')) {
            const email = params[0];
            const rest = restaurants.find(r => r.email === email);
            return { rows: rest ? [{ id: rest.id, password: rest.password }] : [] };
        }
        
        if (normalizedSql.includes('FROM restaurants') && !normalizedSql.includes('email =')) {
            if (normalizedSql.includes('WHERE id =') || normalizedSql.includes('WHERE r.id =')) {
                const id = params[0];
                const rest = restaurants.find(r => r.id === id);
                return { rows: rest ? [rest] : [] };
            }
            return { rows: restaurants.filter(r => r.is_active) };
        }
        
        if (normalizedSql.includes('SELECT average_prep_time FROM restaurants WHERE id =')) {
            const id = params[0];
            const rest = restaurants.find(r => r.id === id);
            return { rows: rest ? [{ average_prep_time: rest.average_prep_time }] : [] };
        }
        
        if (normalizedSql.includes('SELECT price FROM menu_items WHERE id =')) {
            const [id, restaurant_id] = params;
            const item = menu_items.find(mi => mi.id === id && mi.restaurant_id === restaurant_id);
            return { rows: item ? [{ price: item.price }] : [] };
        }
        
        if (normalizedSql.includes('INSERT INTO menu_items')) {
            const [restaurant_id, name, price] = params;
            const id = 'item-' + Date.now();
            menu_items.push({ id, restaurant_id, name, price: parseFloat(price), is_available: true });
            saveMockDb();
            return { rows: [{ id }] };
        }
        
        if (normalizedSql.includes('INSERT INTO orders')) {
            let user_id, restaurant_id, total_amount, fulfillment_type, current_driver_eta, scheduled_fire_time, table_id = null;
            let escrow_status = 'HOLD';
            let is_demo = false;
            let id = 'order-' + Date.now();

            if (normalizedSql.includes('is_demo')) {
                // Special insert during live demo or simulator:
                // INSERT INTO orders (id, user_id, restaurant_id, total_amount, fulfillment_type, current_driver_eta, scheduled_fire_time, order_status, escrow_status, is_demo, table_id)
                [id, user_id, restaurant_id, total_amount, fulfillment_type, current_driver_eta, scheduled_fire_time, , escrow_status, is_demo, table_id] = params;
            } else {
                if (params.length === 8) {
                    [user_id, restaurant_id, total_amount, fulfillment_type, current_driver_eta, scheduled_fire_time, , table_id] = params;
                } else if (params.length === 7) {
                    if (params[6] === 'PLACED') {
                        [user_id, restaurant_id, total_amount, fulfillment_type, current_driver_eta, scheduled_fire_time] = params;
                    } else {
                        [user_id, restaurant_id, total_amount, fulfillment_type, current_driver_eta, scheduled_fire_time, table_id] = params;
                    }
                } else {
                    [user_id, restaurant_id, total_amount, fulfillment_type, current_driver_eta, scheduled_fire_time] = params;
                }
            }
            
            const newOrder = {
                id, 
                user_id, 
                restaurant_id, 
                total_amount: parseFloat(total_amount), 
                fulfillment_type,
                current_driver_eta: new Date(current_driver_eta), 
                scheduled_fire_time: new Date(scheduled_fire_time), 
                order_status: 'PLACED',
                escrow_status: escrow_status || 'HOLD',
                is_demo: !!is_demo,
                created_at: new Date(),
                table_id: table_id
            };
            orders.push(newOrder);
            
            if (table_id) {
                const table = tables.find(t => t.id === table_id && t.restaurant_id === restaurant_id);
                if (table) {
                    table.is_available = false;
                }
            }
            
            saveMockDb();
            return { rows: [{ id, scheduled_fire_time }] };
        }
        
        if (normalizedSql.includes('INSERT INTO order_items')) {
            const [order_id, menu_item_id, quantity, price_at_purchase] = params;
            order_items.push({ order_id, menu_item_id, quantity, price_at_purchase });
            saveMockDb();
            return { rows: [] };
        }
        
        if (normalizedSql.includes('SELECT restaurant_id, order_status FROM orders WHERE id =')) {
            const id = params[0];
            const order = orders.find(o => o.id === id);
            return { rows: order ? [{ restaurant_id: order.restaurant_id, order_status: order.order_status }] : [] };
        }
        
        if (normalizedSql.includes('SELECT * FROM menu_items WHERE restaurant_id =')) {
            const restaurant_id = params[0];
            const items = menu_items.filter(mi => mi.restaurant_id === restaurant_id);
            return { rows: items };
        }
        
        if (normalizedSql.includes('SELECT o.id, o.restaurant_id, r.latitude, r.longitude')) {
            const id = params[0];
            const order = orders.find(o => o.id === id && o.order_status === 'PREPARING');
            if (order) {
                const rest = restaurants.find(r => r.id === order.restaurant_id);
                if (rest) {
                    return { rows: [{ id: order.id, restaurant_id: order.restaurant_id, latitude: rest.latitude, longitude: rest.longitude }] };
                }
            }
            return { rows: [] };
        }
        
        if (normalizedSql.includes("UPDATE orders SET order_status = 'COMPLETED'")) {
            const id = params[0];
            const order = orders.find(o => o.id === id);
            if (order) {
                order.order_status = 'COMPLETED';
                saveMockDb();
            }
            return { rows: [] };
        }
        
        if (normalizedSql.includes('SELECT order_status FROM orders WHERE id =')) {
            const id = params[0];
            const order = orders.find(o => o.id === id);
            return { rows: order ? [{ order_status: order.order_status }] : [] };
        }
        
        if (normalizedSql.includes('escrow_status = \'HOLD\'')) {
            const [payment_intent_id, id] = params;
            const order = orders.find(o => o.id === id);
            if (order) {
                order.payment_intent_id = payment_intent_id;
                order.escrow_status = 'HOLD';
                saveMockDb();
                return { rows: [{ id: order.id, order_status: order.order_status }] };
            }
            return { rows: [] };
        }

        if (normalizedSql.includes('SELECT * FROM restaurant_tables WHERE restaurant_id =')) {
            const restaurant_id = params[0];
            const filtered = tables.filter(t => t.restaurant_id === restaurant_id);
            return { rows: filtered };
        }

        if (normalizedSql.includes('INSERT INTO restaurant_tables')) {
            const [restaurant_id, table_number, capacity, is_available] = params;
            const newTable = {
                id: 'table-' + Date.now(),
                restaurant_id,
                table_number,
                capacity: parseInt(capacity) || 2,
                is_available: is_available === undefined || is_available === 'true' || is_available === true
            };
            tables.push(newTable);
            saveMockDb();
            return { rows: [newTable] };
        }

        if (normalizedSql.includes('UPDATE restaurant_tables SET is_available =')) {
            if (normalizedSql.includes('is_available = FALSE') || normalizedSql.includes('is_available = false')) {
                const [id, restaurant_id] = params;
                const table = tables.find(t => t.id === id && t.restaurant_id === restaurant_id);
                if (table) {
                    table.is_available = false;
                    saveMockDb();
                    return { rows: [table] };
                }
            } else {
                const [is_available, id, restaurant_id] = params;
                const table = tables.find(t => t.id === id && t.restaurant_id === restaurant_id);
                if (table) {
                    table.is_available = is_available === 'true' || is_available === true;
                    saveMockDb();
                    return { rows: [table] };
                }
            }
            return { rows: [] };
        }

        if (normalizedSql.includes('UPDATE menu_items SET is_available =')) {
            const [is_available, id, restaurant_id] = params;
            const item = menu_items.find(mi => mi.id === id && mi.restaurant_id === restaurant_id);
            if (item) {
                item.is_available = is_available === 'true' || is_available === true;
                saveMockDb();
                return { rows: [item] };
            }
            return { rows: [] };
        }

        if (normalizedSql.includes('FROM orders') && normalizedSql.includes('restaurant_id =')) {
            const restaurant_id = params[0];
            const filtered = orders.filter(o => o.restaurant_id === restaurant_id).map(o => {
                const table = tables.find(t => t.id === o.table_id);
                return {
                    ...o,
                    reserved_table_number: table ? table.table_number : null
                };
            });
            // Sort by scheduled_fire_time DESC
            filtered.sort((a, b) => new Date(b.scheduled_fire_time) - new Date(a.scheduled_fire_time));
            return { rows: filtered };
        }

        if (normalizedSql.includes('FROM order_items') && normalizedSql.includes('JOIN menu_items')) {
            const order_id = params[0];
            const items = order_items.filter(oi => oi.order_id === order_id).map(oi => {
                const menuItem = menu_items.find(mi => mi.id === oi.menu_item_id);
                return {
                    order_id: oi.order_id,
                    menu_item_id: oi.menu_item_id,
                    quantity: oi.quantity,
                    price_at_purchase: oi.price_at_purchase,
                    name: menuItem ? menuItem.name : 'Unknown Item'
                };
            });
            return { rows: items };
        }

        if (normalizedSql.includes('UPDATE orders SET order_status =') && !normalizedSql.includes('WHERE order_status = \'PLACED\'')) {
            const [status, id] = params;
            const order = orders.find(o => o.id === id);
            if (order) {
                order.order_status = status;
                saveMockDb();
                return { rows: [order] };
            }
            return { rows: [] };
        }

        if (normalizedSql.includes("DELETE FROM orders WHERE is_demo =") || normalizedSql.includes("is_demo = TRUE") || normalizedSql.includes("is_demo = true")) {
            const demoOrderIds = orders.filter(o => o.is_demo).map(o => o.id);
            for (let i = orders.length - 1; i >= 0; i--) {
                if (orders[i].is_demo) {
                    orders.splice(i, 1);
                }
            }
            for (let i = order_items.length - 1; i >= 0; i--) {
                if (demoOrderIds.includes(order_items[i].order_id)) {
                    order_items.splice(i, 1);
                }
            }
            saveMockDb();
            return { rows: [] };
        }

        if (normalizedSql.includes("DELETE FROM order_items WHERE order_id IN")) {
            // Handled together in delete orders or standard cascade
            return { rows: [] };
        }
        
        console.log('Mocked Unmatched query:', sql);
        return { rows: [] };
    }
}

let pool;
const dbUrl = process.env.DATABASE_URL;
const isLocalhostDb = dbUrl && (dbUrl.includes("localhost") || dbUrl.includes("127.0.0.1") || dbUrl.trim() === "");

// Database auto-creation for table management tables
async function ensureDbSchema() {
    try {
        // 1. Create Core Tables in order
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id VARCHAR(255) PRIMARY KEY DEFAULT 'user-' || floor(random() * 1000000000)::text,
                name VARCHAR(255),
                email VARCHAR(255) UNIQUE,
                password VARCHAR(255),
                phone VARCHAR(100)
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS restaurants (
                id VARCHAR(255) PRIMARY KEY DEFAULT 'rest-' || floor(random() * 1000000000)::text,
                name VARCHAR(255),
                address TEXT,
                latitude DOUBLE PRECISION,
                longitude DOUBLE PRECISION,
                average_prep_time INT DEFAULT 15,
                is_active BOOLEAN DEFAULT TRUE,
                email VARCHAR(255) UNIQUE,
                password VARCHAR(255)
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS menu_items (
                id VARCHAR(255) PRIMARY KEY DEFAULT 'item-' || floor(random() * 1000000000)::text,
                restaurant_id VARCHAR(255) REFERENCES restaurants(id) ON DELETE CASCADE,
                name VARCHAR(255),
                description TEXT,
                price DECIMAL(10, 2),
                is_available BOOLEAN DEFAULT TRUE
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS restaurant_tables (
                id VARCHAR(255) PRIMARY KEY DEFAULT 'table-' || floor(random() * 1000000000)::text,
                restaurant_id VARCHAR(255) REFERENCES restaurants(id) ON DELETE CASCADE,
                table_number VARCHAR(100) NOT NULL,
                capacity INT NOT NULL,
                is_available BOOLEAN DEFAULT TRUE
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS orders (
                id VARCHAR(255) PRIMARY KEY DEFAULT 'order-' || floor(random() * 1000000000)::text,
                user_id VARCHAR(255),
                restaurant_id VARCHAR(255),
                total_amount DECIMAL(10, 2),
                fulfillment_type VARCHAR(50),
                current_driver_eta TIMESTAMP,
                scheduled_fire_time TIMESTAMP,
                order_status VARCHAR(50) DEFAULT 'PLACED',
                table_id VARCHAR(255),
                payment_intent_id VARCHAR(255),
                escrow_status VARCHAR(50)
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS order_items (
                order_id VARCHAR(255),
                menu_item_id VARCHAR(255),
                quantity INT,
                price_at_purchase DECIMAL(10, 2),
                PRIMARY KEY (order_id, menu_item_id)
            );
        `);

        // 2. Check if is_available column exists in menu_items, if not add it
        const columnCheck = await pool.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name='menu_items' AND column_name='is_available';
        `);
        if (columnCheck.rows.length === 0) {
            await pool.query(`ALTER TABLE menu_items ADD COLUMN is_available BOOLEAN DEFAULT TRUE;`);
            console.log("Added 'is_available' column to 'menu_items' table.");
        }
        
        // Ensure table_id column exists in orders table to handle reservations
        const orderColumnCheck = await pool.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name='orders' AND column_name='table_id';
        `);
        if (orderColumnCheck.rows.length === 0) {
            await pool.query(`ALTER TABLE orders ADD COLUMN table_id VARCHAR(255);`);
            console.log("Added 'table_id' column to 'orders' table.");
        }

        // Ensure payment_intent_id column exists in orders
        const paymentCheck = await pool.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name='orders' AND column_name='payment_intent_id';
        `);
        if (paymentCheck.rows.length === 0) {
            await pool.query(`ALTER TABLE orders ADD COLUMN payment_intent_id VARCHAR(255);`);
            console.log("Added 'payment_intent_id' column to 'orders' table.");
        }

        // Ensure escrow_status column exists in orders
        const escrowCheck = await pool.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name='orders' AND column_name='escrow_status';
        `);
        if (escrowCheck.rows.length === 0) {
            await pool.query(`ALTER TABLE orders ADD COLUMN escrow_status VARCHAR(50);`);
            console.log("Added 'escrow_status' column to 'orders' table.");
        }

        // Ensure is_demo column exists in orders
        const demoColumnCheck = await pool.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name='orders' AND column_name='is_demo';
        `);
        if (demoColumnCheck.rows.length === 0) {
            await pool.query(`ALTER TABLE orders ADD COLUMN is_demo BOOLEAN DEFAULT FALSE;`);
            console.log("Added 'is_demo' column to 'orders' table.");
        }

        // 3. Auto-Seed Tables if empty
        const userCount = await pool.query('SELECT COUNT(*) FROM users');
        if (parseInt(userCount.rows[0].count) === 0) {
            await pool.query(`
                INSERT INTO users (id, name, email, password, phone)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT DO NOTHING
            `, ["mock-user-id", "Alex Driver", "alex@traveler.com", "$2a$10$7zB3rTeeW/eXmFvC0w.6n.I6mS6/6x1Z7r3V4j9M1Y5W7g8b9cOaG", "+1-555-0199"]);
            console.log("🌱 Seeded default traveler user.");
        }

        const restCount = await pool.query('SELECT COUNT(*) FROM restaurants');
        if (parseInt(restCount.rows[0].count) === 0) {
            await pool.query(`
                INSERT INTO restaurants (id, name, address, latitude, longitude, average_prep_time, is_active, email, password)
                VALUES 
                ('f82e4f22-3816-4243-9a15-e642b8c2a0c0', 'Pitstop Highway Diner', '456 Interstate Route 95, Exit 12', 40.7128, -74.0060, 15, true, 'diner@pitstop.com', 'password'),
                ('1b1df56c-9f3f-4c12-9332-58144aa5b7f2', 'Kitchen Live Diner', '789 Highway Avenue', 40.7306, -73.9352, 10, true, 'kitchen@live.com', 'password')
                ON CONFLICT DO NOTHING
            `);
            console.log("🌱 Seeded default partner restaurants.");
        }

        const menuCount = await pool.query('SELECT COUNT(*) FROM menu_items');
        if (parseInt(menuCount.rows[0].count) === 0) {
            await pool.query(`
                INSERT INTO menu_items (id, restaurant_id, name, description, price, is_available)
                VALUES 
                ('item-burger', 'f82e4f22-3816-4243-9a15-e642b8c2a0c0', 'Classic Trucker Burger', 'Juicy beef patty with cheddar cheese, lettuce, and secret sauce. Comes with fries.', 14.99, true),
                ('item-coffee', 'f82e4f22-3816-4243-9a15-e642b8c2a0c0', 'Roadtrip Iced Coffee', 'Freshly brewed cold brew over ice with vanilla sweet cream.', 4.50, true),
                ('item-burger-2', '1b1df56c-9f3f-4c12-9332-58144aa5b7f2', 'Classic Trucker Burger', 'Juicy beef patty with cheddar cheese, lettuce, and secret sauce. Comes with fries.', 14.99, true),
                ('item-coffee-2', '1b1df56c-9f3f-4c12-9332-58144aa5b7f2', 'Roadtrip Iced Coffee', 'Freshly brewed cold brew over ice with vanilla sweet cream.', 4.50, true)
                ON CONFLICT DO NOTHING
            `);
            console.log("🌱 Seeded default menu items.");
        }

        const tableCount = await pool.query('SELECT COUNT(*) FROM restaurant_tables');
        if (parseInt(tableCount.rows[0].count) === 0) {
            await pool.query(`
                INSERT INTO restaurant_tables (id, restaurant_id, table_number, capacity, is_available)
                VALUES 
                ('table-d1', 'f82e4f22-3816-4243-9a15-e642b8c2a0c0', 'Table 1', 4, true),
                ('table-d2', 'f82e4f22-3816-4243-9a15-e642b8c2a0c0', 'Table 2', 2, false),
                ('table-d3', 'f82e4f22-3816-4243-9a15-e642b8c2a0c0', 'Table 3', 6, true),
                ('table-k1', '1b1df56c-9f3f-4c12-9332-58144aa5b7f2', 'Table A', 4, true),
                ('table-k2', '1b1df56c-9f3f-4c12-9332-58144aa5b7f2', 'Table B', 4, true)
                ON CONFLICT DO NOTHING
            `);
            console.log("🌱 Seeded default restaurant tables.");
        }
        
        console.log("Database schema check and seeding completed successfully.");
    } catch (e) {
        console.error("Failed to ensure DB schema:", e);
    }
}

if (dbUrl && !isLocalhostDb) {
    try {
        pool = new Pool({ connectionString: dbUrl });
        pool.connect((err, client, release) => {
            if (err) {
                console.log('Database connection fallback: using in-memory mock storage mode.');
                pool = new MockPool();
            } else {
                console.log('Connected to PostgreSQL database successfully.');
                release();
                ensureDbSchema().catch(e => console.error("ensureDbSchema error:", e));
            }
        });
    } catch (err) {
        console.log('Database connection fallback: using in-memory mock storage mode.');
        pool = new MockPool();
    }
} else {
    console.log('Using in-memory mock storage mode for development/preview.');
    pool = new MockPool();
}

app.get('/api/config/google-maps-key', (req, res) => {
    if (!process.env.GOOGLE_MAPS_API_KEY) {
        return res.status(500).json({ error: "Google Maps API key is not configured." });
    }

    res.json({ apiKey: process.env.GOOGLE_MAPS_API_KEY });
});

// =======================================================
// 🔌 SOCKET.IO REAL-TIME ROUTING & ROOM MANAGEMENT
// =======================================================
io.on('connection', (socket) => {
    console.log(`🔌 New client connected to stream: ${socket.id}`);

    // When a restaurant tablet boots up, it broadcasts a join event containing its ID
    socket.on('join_restaurant_room', (restaurant_id) => {
        socket.join(restaurant_id);
        console.log(`🏪 Tablet Instance joined secure monitoring channel for room: ${restaurant_id}`);
    });

    socket.on('disconnect', () => {
        console.log(`❌ Client connection dropped silently: ${socket.id}`);
    });
});

// =======================================================
// ⏰ INTERNAL TIMING ENGINE CRON-LOOP UTILITY
// =======================================================
async function checkAndFireOrders() {
    try {
        // Query the database to find orders where the current time has passed the scheduled fire time
        const query = `
            UPDATE orders 
            SET order_status = 'PREPARING'
            WHERE order_status = 'PLACED' 
            AND NOW() >= scheduled_fire_time
            RETURNING id, restaurant_id, total_amount, fulfillment_type;
        `;

        const result = await pool.query(query);
        
        // Loop through all orders that turned live right now and push them via WebSockets
        result.rows.forEach(order => {
            console.log(`🔥 Sending fire signal for Order ID: ${order.id}`);

            // Emit a real-time event specifically to the targeted restaurant's tablet screen
            io.to(order.restaurant_id).emit('NEW_KITCHEN_FIRE_ORDER', {
                order_id: order.id,
                type: order.fulfillment_type, // [cite: 132]
                total: order.total_amount // [cite: 131]
            });
        });

    } catch (err) {
        console.error("Timing scan execution fault:", err);
    }
}

// Automatically scan the database for fire-ready orders every 30 seconds
setInterval(checkAndFireOrders, 30000);

// =======================================================
// 🔐 USER REGISTRATION & AUTHENTICATION (JWT FLOW)
// =======================================================
// A secure, hidden string inside your environment to sign digital signatures
// In production, move this directly into your hidden .env file!
const JWT_SECRET = "SUPER_SECRET_STARTUP_SIGNING_KEY_12345";

app.post('/api/auth/register', async (req, res) => {
    const { name, email, password, phone } = req.body;

    if (!name || !email || !password) {
        return res.status(400).json({ error: "Required enrollment registration values missing." });
    }

    try {
        // 1. Encrypt the password using bcrypt hashing algorithm (Salt rounds = 10)
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // 2. Insert the user credentials securely into PostgreSQL database
        // NOTE: If you haven't added a password column to your users table yet, 
        // run: ALTER TABLE users ADD COLUMN password VARCHAR(255); inside pgAdmin.
        const registerQuery = `
            INSERT INTO users (name, email, password, phone)
            VALUES ($1, $2, $3, $4)
            RETURNING id, name, email;
        `;

        const newUser = await pool.query(registerQuery, [name, email, hashedPassword, phone]);
        
        res.status(201).json({
            message: "🎉 Account created successfully!",
            user: newUser.rows[0]
        });

    } catch (error) {
        if (error.code === '23505') { // PostgreSQL unique violation code for email conflicts
            return res.status(400).json({ error: "An account with this email already exists." });
        }
        console.error("Registration Error:", error);
        res.status(500).json({ error: "Database failed to compile new user registry." });
    }
});

// Endpoint B: Existing Traveler Secure Login Validation
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        // 1. Verify if the targeted user profile exists in database
        const userRes = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (userRes.rows.length === 0) {
            return res.status(400).json({ error: "Invalid login credentials provided." });
        }

        const user = userRes.rows[0];

        // 2. Compare incoming raw password against the encrypted hash on disk
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ error: "Invalid login credentials provided." });
        }

        // 3. Issue the JSON Web Token containing the encrypted user profile session ID
        const token = jwt.sign(
            { user_id: user.id, email: user.email },
            JWT_SECRET,
            { expiresIn: '7d' } // Token auto-expires in 7 days for continuous device utility login
        );

        res.json({
            message: "🚀 Authorization successful!",
            token: token,
            user: { id: user.id, name: user.name, email: user.email }
        });

    } catch (error) {
        console.error("Login Exception Loop:", error);
        res.status(500).json({ error: "Backend failed to authenticate credential sequence." });
    }
});

// Register a new restaurant
app.post('/api/restaurants/register', async (req, res) => {
    console.log("🔥 Incoming Registration Request:", req.body); // ADD THIS LINE
    const { name, location, lat, lng, email, password } = req.body;
    
    try {
        const result = await pool.query(
            'INSERT INTO restaurants (name, address, latitude, longitude, email, password) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
            [name, location, lat, lng, email, password]
        );
        res.status(201).json({ restaurant_id: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ error: "Registration failed." });
    }
});

// Restaurant Login
app.post('/api/restaurants/login', async (req, res) => {
    const { email, password } = req.body;
    const result = await pool.query('SELECT id, password FROM restaurants WHERE email = $1', [email]);
    
    if (result.rows.length > 0 && result.rows[0].password === password) {
        res.json({ restaurant_id: result.rows[0].id });
    } else {
        res.status(401).json({ error: "Invalid credentials" });
    }
});

// Middleware Interceptor function to verify signed authorization headers
function verifyToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    // Expecting structure header: "Bearer token_string_goes_here"
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: "Access Denied. Signed authorization token missing." });
    }

    try {
        const verified = jwt.verify(token, JWT_SECRET);
        req.user = verified; // Append verified user object parameters down to the next function handler line
        next(); // Proceed to the actual route calculation logic safely
    } catch (err) {
        res.status(403).json({ error: "Access Forbidden. Security token signatures modified or expired." });
    }
}

// =======================================================
// 🧭 ENDPOINT 1: PLACE PREORDER & SCHEDULE
// =======================================================
app.post('/api/orders/place', verifyToken, async (req, res) => {
    const { user_id, restaurant_id, fulfillment_type, initial_eta_minutes, items, table_id } = req.body;

    try {
        await pool.query('BEGIN'); // Start a secure data transaction [cite: 200]

        // 1. Fetch the targeted restaurant's preparation speed [cite: 198]
        const restaurantRes = await pool.query(
            'SELECT average_prep_time FROM restaurants WHERE id = $1',
            [restaurant_id]
        );

        if (restaurantRes.rows.length === 0) {
            return res.status(404).json({ error: "Restaurant not found." });
        }

        const avgPrepTime = restaurantRes.rows[0].average_prep_time;

        // 2. Perform Predictive Timing Math [cite: 200]
        const currentTime = new Date();
        const driverArrivalTimestamp = new Date(currentTime.getTime() + initial_eta_minutes * 60 * 1000); // [cite: 199]
        const scheduledFireTimestamp = new Date(driverArrivalTimestamp.getTime() - avgPrepTime * 60 * 1000); // [cite: 200]

        // 3. Calculate financial totals by fetching item costs from DB
        let totalAmount = 0;
        const processedItems = [];

        for (const item of items) {
            const menuRes = await pool.query(
                'SELECT price FROM menu_items WHERE id = $1 AND restaurant_id = $2',
                [item.menu_item_id, restaurant_id]
            );
            if (menuRes.rows.length > 0) {
                const itemPrice = parseFloat(menuRes.rows[0].price);
                totalAmount += itemPrice * item.quantity;
                processedItems.push({ ...item, price: itemPrice });
            }
        }

        // 4. Create Master Record in orders table
        const columns = ['user_id', 'restaurant_id', 'total_amount', 'fulfillment_type', 'current_driver_eta', 'scheduled_fire_time', 'order_status'];
        const values = [user_id, restaurant_id, totalAmount, fulfillment_type, driverArrivalTimestamp, scheduledFireTimestamp, 'PLACED'];
        
        if (fulfillment_type === 'DINE_IN' && table_id) {
            columns.push('table_id');
            values.push(table_id);
        }

        const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
        const orderInsertQuery = `
            INSERT INTO orders (${columns.join(', ')})
            VALUES (${placeholders})
            RETURNING id, scheduled_fire_time;
        `;
        
        const orderRes = await pool.query(orderInsertQuery, values);
        const newOrderId = orderRes.rows[0].id;

        // Reserve the table in real-time if it's a Dine-In order
        if (fulfillment_type === 'DINE_IN' && table_id) {
            await pool.query(
                'UPDATE restaurant_tables SET is_available = FALSE WHERE id = $1 AND restaurant_id = $2',
                [table_id, restaurant_id]
            );
            
            // Sync mock database tables list
            const table = tables.find(t => t.id === table_id && t.restaurant_id === restaurant_id);
            if (table) table.is_available = false;

            // Re-emit table status changed so other connected clients update their UI
            io.to(restaurant_id).emit('TABLE_STATUS_CHANGED', {
                table_id,
                is_available: false
            });
        }

        // 5. Populate order_items junction table mapping item snapshot prices [cite: 200]
        const itemInsertQuery = `
            INSERT INTO order_items (order_id, menu_item_id, quantity, price_at_purchase)
            VALUES ($1, $2, $3, $4);
        `;

        for (const item of processedItems) {
            await pool.query(itemInsertQuery, [newOrderId, item.menu_item_id, item.quantity, item.price]);
        }

        await pool.query('COMMIT');

        // Emit real-time event to the restaurant room that a new order has been placed
        io.to(restaurant_id).emit('ORDER_PLACED', {
            order_id: newOrderId,
            type: fulfillment_type,
            total: totalAmount,
            scheduled_fire_time: orderRes.rows[0].scheduled_fire_time,
            status: 'PLACED'
        });

        // Trigger immediate check in the background in case this order should be fired instantly
        setTimeout(checkAndFireOrders, 100);

        res.status(201).json({
            message: "⚡ Order placed and scheduled successfully!",
            order_id: newOrderId,
            scheduled_fire_time: orderRes.rows[0].scheduled_fire_time,
            total_price: totalAmount
        });

    } catch (error) {
        await pool.query('ROLLBACK');
        console.error("Error creating preorder transaction:", error);
        res.status(500).json({ error: "Server failed to process order compilation." });
    }
});

// =======================================================
// 🚗 ADAPTED HIGHWAY TRACKING ENDPOINT LINK
// =======================================================
app.patch('/api/navigation/update-eta', async (req, res) => {
    const { order_id, updated_eta_minutes } = req.body;
    await ensureOrderExists(order_id);

    try {
        // Query both order and the restaurant's prep time
        const orderRes = await pool.query(`
            SELECT o.restaurant_id, o.order_status, r.average_prep_time 
            FROM orders o
            JOIN restaurants r ON o.restaurant_id = r.id
            WHERE o.id = $1
        `, [order_id]);
        
        if (orderRes.rows.length === 0) {
            // Check in memory mock as fallback
            const memOrder = orders.find(o => o.id === order_id);
            if (!memOrder) return res.status(404).send("Order absent.");
            const memRest = restaurants.find(r => r.id === memOrder.restaurant_id);
            orderRes.rows = [{
                restaurant_id: memOrder.restaurant_id,
                order_status: memOrder.order_status,
                average_prep_time: memRest ? memRest.average_prep_time : 15
            }];
        }

        const { order_status, restaurant_id, average_prep_time } = orderRes.rows[0];

        const currentTime = new Date();
        const driverArrivalTimestamp = new Date(currentTime.getTime() + updated_eta_minutes * 60 * 1000);
        const scheduledFireTimestamp = new Date(driverArrivalTimestamp.getTime() - average_prep_time * 60 * 1000);

        if (order_status === 'PREPARING' && updated_eta_minutes > 25) {
            // Trigger emergency hold alert
            io.to(restaurant_id).emit('EMERGENCY_HOLD_ALERT', {
                order_id: order_id,
                message: "⚠️ Traveler stuck in severe highway traffic detour! Pause preparation immediately."
            });
            
            // Also update order status or timing anyway so they see it on the kitchen display
            await pool.query(`
                UPDATE orders 
                SET current_driver_eta = $1, scheduled_fire_time = $2, order_status = 'PLACED'
                WHERE id = $3
            `, [driverArrivalTimestamp, scheduledFireTimestamp, order_id]);
            
            const matchedMemOrder = orders.find(o => o.id === order_id);
            if (matchedMemOrder) {
                matchedMemOrder.current_driver_eta = driverArrivalTimestamp;
                matchedMemOrder.scheduled_fire_time = scheduledFireTimestamp;
                matchedMemOrder.order_status = 'PLACED';
                saveMockDb();
            }

            // Let the kitchen display know it reverted to PLACED (scheduled) so they can stop prep
            io.to(restaurant_id).emit('ORDER_SCHEDULE_UPDATED', {
                order_id,
                updated_eta_minutes,
                scheduled_fire_time: scheduledFireTimestamp,
                order_status: 'PLACED'
            });

            return res.json({ status: "EMERGENCY_HOLD_TRIGGERED", scheduled_fire_time: scheduledFireTimestamp });
        }

        // Standard update handling: update current driver ETA and recalculate scheduled fire time if it is not yet cooking
        if (order_status === 'PLACED') {
            await pool.query(`
                UPDATE orders 
                SET current_driver_eta = $1, scheduled_fire_time = $2
                WHERE id = $3
            `, [driverArrivalTimestamp, scheduledFireTimestamp, order_id]);

            const matchedMemOrder = orders.find(o => o.id === order_id);
            if (matchedMemOrder) {
                matchedMemOrder.current_driver_eta = driverArrivalTimestamp;
                matchedMemOrder.scheduled_fire_time = scheduledFireTimestamp;
                saveMockDb();
            }

            // Emit to let the kitchen know the timing has updated in real-time
            io.to(restaurant_id).emit('ORDER_SCHEDULE_UPDATED', {
                order_id,
                updated_eta_minutes,
                scheduled_fire_time: scheduledFireTimestamp,
                order_status: 'PLACED'
            });
        } else {
            // Just update driver ETA if already preparing
            await pool.query(`
                UPDATE orders 
                SET current_driver_eta = $1
                WHERE id = $2
            `, [driverArrivalTimestamp, order_id]);

            const matchedMemOrder = orders.find(o => o.id === order_id);
            if (matchedMemOrder) {
                matchedMemOrder.current_driver_eta = driverArrivalTimestamp;
                saveMockDb();
            }

            // Emit to kitchen display
            io.to(restaurant_id).emit('ORDER_ETA_UPDATED', {
                order_id,
                updated_eta_minutes,
                order_status: 'PREPARING'
            });
        }

        // Trigger an immediate check of all scheduled preorders in case this update triggers an instant fire window
        setTimeout(checkAndFireOrders, 50);

        res.json({ status: "ETA_SYNCED", scheduled_fire_time: scheduledFireTimestamp });

    } catch (err) {
        console.error("Navigation ETA update failed:", err);
        res.status(500).send("Internal server error handling progress sync.");
    }
});

// =======================================================
// 🚗 DYNAMIC ETA RE-CALCULATION & GEOLOCATION STREAM ENGINE
// =======================================================
app.put('/api/orders/:order_id/update-eta', async (req, res) => {
    const { order_id } = req.params;
    const { current_lat, current_lng, updated_eta_minutes } = req.body;
    
    // Fallback security check to ensure simulation continuity
    await ensureOrderExists(order_id);

    try {
        // 1. Fetch order details and the matching restaurant's coordinates & speed parameters
        let orderRes = await pool.query(`
            SELECT o.restaurant_id, o.order_status, r.latitude, r.longitude, r.average_prep_time 
            FROM orders o
            JOIN restaurants r ON o.restaurant_id = r.id
            WHERE o.id = $1
        `, [order_id]);
        
        // In-memory fallback handler if working in raw mock simulation mode
        if (orderRes.rows.length === 0) {
            const memOrder = orders.find(o => o.id === order_id);
            if (!memOrder) return res.status(404).json({ error: "Order context missing." });
            const memRest = restaurants.find(r => r.id === memOrder.restaurant_id);
            orderRes.rows = [{
                restaurant_id: memOrder.restaurant_id,
                order_status: memOrder.order_status,
                latitude: memRest ? memRest.latitude : 17.5200,
                longitude: memRest ? memRest.longitude : 78.4500,
                average_prep_time: memRest ? memRest.average_prep_time : 15
            }];
        }

        const { order_status, restaurant_id, latitude, longitude, average_prep_time } = orderRes.rows[0];

        // 2. Core Prototyping Moat: Dynamic Math Estimation based on live pings
        let finalEtaMinutes = updated_eta_minutes;
        
        if (current_lat && current_lng && !finalEtaMinutes) {
            // Straight line distance calculation vector across coordinates grid
            const distanceDelta = Math.sqrt(Math.pow(current_lat - latitude, 2) + Math.pow(current_lng - longitude, 2));
            // Convert coordinate distance into reliable highway drive time parameters (1 unit gap ~ 60 mins driving)
            finalEtaMinutes = Math.max(2, Math.round(distanceDelta * 60));
        }

        if (!finalEtaMinutes) {
            return res.status(400).json({ error: "Missing navigation tracking coordinates or custom ETA minutes." });
        }

        const currentTime = new Date();
        const driverArrivalTimestamp = new Date(currentTime.getTime() + finalEtaMinutes * 60 * 1000);
        const scheduledFireTimestamp = new Date(driverArrivalTimestamp.getTime() - average_prep_time * 60 * 1000);

        // 3. CASE A: EMERGENCY HOLD ACTION (Traffic Jam hit while food is cooking)
        if (order_status === 'PREPARING' && finalEtaMinutes > (average_prep_time + 15)) {
            io.to(restaurant_id).emit('EMERGENCY_HOLD_ALERT', {
                order_id: order_id,
                message: `⚠️ Traveler delayed by traffic jam! New ETA: ${finalEtaMinutes} mins. Pausing kitchen fire sequence.`
            });
            
            await pool.query(`
                UPDATE orders 
                SET current_driver_eta = $1, scheduled_fire_time = $2, order_status = 'PLACED'
                WHERE id = $3
            `, [driverArrivalTimestamp, scheduledFireTimestamp, order_id]);
            
            const matchedMemOrder = orders.find(o => o.id === order_id);
            if (matchedMemOrder) {
                matchedMemOrder.current_driver_eta = driverArrivalTimestamp;
                matchedMemOrder.scheduled_fire_time = scheduledFireTimestamp;
                matchedMemOrder.order_status = 'PLACED';
                saveMockDb();
            }

            io.to(restaurant_id).emit('ORDER_SCHEDULE_UPDATED', {
                order_id,
                updated_eta_minutes: finalEtaMinutes,
                scheduled_fire_time: scheduledFireTimestamp,
                order_status: 'PLACED'
            });

            return res.json({ 
                status: "EMERGENCY_HOLD_TRIGGERED", 
                calculated_eta_minutes: finalEtaMinutes,
                scheduled_fire_time: scheduledFireTimestamp 
            });
        }

        // 4. CASE B: Standard update loop before cooking (Shift the fire window dynamically)
        if (order_status === 'PLACED') {
            await pool.query(`
                UPDATE orders 
                SET current_driver_eta = $1, scheduled_fire_time = $2
                WHERE id = $3
            `, [driverArrivalTimestamp, scheduledFireTimestamp, order_id]);

            const matchedMemOrder = orders.find(o => o.id === order_id);
            if (matchedMemOrder) {
                matchedMemOrder.current_driver_eta = driverArrivalTimestamp;
                matchedMemOrder.scheduled_fire_time = scheduledFireTimestamp;
                saveMockDb();
            }

            io.to(restaurant_id).emit('ORDER_SCHEDULE_UPDATED', {
                order_id,
                updated_eta_minutes: finalEtaMinutes,
                scheduled_fire_time: scheduledFireTimestamp,
                order_status: 'PLACED'
            });
        } else {
            // CASE C: Order is already actively frying/baking, just update driver arrival clock on tablet display
            await pool.query(`
                UPDATE orders 
                SET current_driver_eta = $1
                WHERE id = $2
            `, [driverArrivalTimestamp, order_id]);

            const matchedMemOrder = orders.find(o => o.id === order_id);
            if (matchedMemOrder) {
                matchedMemOrder.current_driver_eta = driverArrivalTimestamp;
                saveMockDb();
            }

            io.to(restaurant_id).emit('ORDER_ETA_UPDATED', {
                order_id,
                updated_eta_minutes: finalEtaMinutes,
                order_status: 'PREPARING'
            });
        }

        // Re-run standard internal scanning pipeline instantly to check if new window hits criteria
        setTimeout(checkAndFireOrders, 50);

        res.json({ 
            status: "ETA_SYNCED", 
            calculated_eta_minutes: finalEtaMinutes, 
            scheduled_fire_time: scheduledFireTimestamp 
        });

    } catch (err) {
        console.error("Dynamic ETA engine loop error:", err);
        res.status(500).json({ error: "Internal engine fault compiling dynamic synchronization parameters." });
    }
});

// =======================================================
// RESTAURANTS ENDPOINT: Fetch all active restaurants
// =======================================================
app.get('/api/restaurants', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM restaurants');
        res.json(result.rows);
    } catch (err) {
        console.error("Error fetching restaurants:", err);
        res.status(500).json({ error: "Failed to fetch restaurants." });
    }
});

// =======================================================
// MENU ENDPOINT: Fetch restaurant menu items for modal
// =======================================================
app.get('/api/restaurants/:restaurant_id/menu', async (req, res) => {
    try {
        const menu = await pool.query('SELECT * FROM menu_items WHERE restaurant_id = $1', [req.params.restaurant_id]);
        res.json(menu.rows);
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch menu." });
    }
});
// =======================================================
// 🏁 FULFILLMENT ENDPOINT: ARRIVAL & ESCROW RELEASE
// =======================================================
app.post('/api/orders/fulfill', async (req, res) => {
    const { order_id, current_lat, current_lng } = req.body;
    await ensureOrderExists(order_id);

    try {
        // 1. Fetch order and restaurant location data
        let orderData = await pool.query(`
            SELECT o.id, o.restaurant_id, r.latitude, r.longitude, o.order_status 
            FROM orders o
            JOIN restaurants r ON o.restaurant_id = r.id
            WHERE o.id = $1
        `, [order_id]);

        if (orderData.rows.length === 0) {
            // Check fallback memory
            const memOrder = orders.find(o => o.id === order_id);
            if (memOrder) {
                const rest = restaurants.find(r => r.id === memOrder.restaurant_id);
                if (rest) {
                    orderData.rows = [{
                        id: memOrder.id,
                        restaurant_id: memOrder.restaurant_id,
                        latitude: parseFloat(rest.latitude),
                        longitude: parseFloat(rest.longitude),
                        order_status: memOrder.order_status
                    }];
                }
            }
        }

        if (orderData.rows.length === 0) {
            return res.status(404).json({ error: "Order not found." });
        }

        const { latitude, longitude } = orderData.rows[0];

        // 2. Simple Geofence Check: Calculate distance (using rough approximation)
        const distance = Math.sqrt(Math.pow(current_lat - latitude, 2) + Math.pow(current_lng - longitude, 2));

        if (distance > 0.05) { // Relax the simulation boundary slightly for smoother testing/simulation flow (0.05 approx 5km)
            return res.status(403).json({ error: "Traveler is outside the restaurant boundary for completion." });
        }

        // 3. Update order status and trigger fulfillment
        await pool.query("UPDATE orders SET order_status = 'COMPLETED' WHERE id = $1", [order_id]);
        
        const matchedMemOrder = orders.find(o => o.id === order_id);
        if (matchedMemOrder) {
            matchedMemOrder.order_status = 'COMPLETED';
            saveMockDb();
        }

        // 4. Push "Order Ready" celebration via WebSockets
        io.to(orderData.rows[0].restaurant_id).emit('ORDER_FULFILLED', {
            order_id: order_id,
            message: "✅ Order successfully picked up. Escrow funds released."
        });

        res.json({ status: "SUCCESS", message: "Order marked COMPLETED. Funds released to restaurant." });

    } catch (err) {
        console.error("Fulfillment error:", err);
        res.status(500).json({ error: "Server failed to process order fulfillment." });
    }
});
// =======================================================
// 💸 PAYMENT GATEWAY WEBHOOK (Escrow Authorization Sync)
// =======================================================
app.post('/api/webhooks/payment-success', async (req, res) => {
    const { payment_intent_id, metadata } = req.body;
    
    if (!metadata || !metadata.order_id) {
        return res.status(400).json({ error: "Missing structural order metadata payload." });
    }

    const targetOrderId = metadata.order_id;

    try {
        const checkOrderRes = await pool.query(
            'SELECT order_status FROM orders WHERE id = $1',
            [targetOrderId]
        );

        if (checkOrderRes.rows.length === 0) {
            return res.status(404).json({ error: "Target order instance missing in system database." });
        }

        const updatePaymentQuery = `
            UPDATE orders 
            SET payment_intent_id = $1, escrow_status = 'HOLD'
            WHERE id = $2
            RETURNING id, order_status;
        `;
        
        await pool.query(updatePaymentQuery, [payment_intent_id, targetOrderId]);
        console.log(`💳 Escrow Verified: Authorized hold secured for Order ${targetOrderId}. Balance locked.`);
        
        res.status(200).json({ received: true, status: "ESCROW_HOLD_CONFIRMED" });

    } catch (error) {
        console.error("🚨 Critical Payment Webhook Handler Exception:", error);
        res.status(500).json({ error: "Internal server error processing transaction sync streams." });
    }
});

// Add Menu Item endpoint (required by restaurant admin)
app.post('/api/restaurants/menu/add', async (req, res) => {
    const { restaurant_id, name, price } = req.body;
    try {
        const query = `
            INSERT INTO menu_items (restaurant_id, name, price)
            VALUES ($1, $2, $3)
            RETURNING id;
        `;
        const result = await pool.query(query, [restaurant_id, name, parseFloat(price)]);
        res.status(201).json({ id: result.rows[0]?.id });
    } catch (err) {
        console.error("Error adding menu item:", err);
        res.status(500).json({ error: "Failed to add menu item." });
    }
});

// =======================================================
// 🏪 TABLE & FOOD AVAILABILITY MANAGEMENT ENDPOINTS
// =======================================================

// 1. Get all tables for a restaurant
app.get('/api/restaurants/:restaurant_id/tables', async (req, res) => {
    const { restaurant_id } = req.params;
    try {
        const result = await pool.query(
            'SELECT * FROM restaurant_tables WHERE restaurant_id = $1 ORDER BY table_number ASC',
            [restaurant_id]
        );
        res.json(result.rows);
    } catch (err) {
        console.error("Error fetching tables:", err);
        res.status(500).json({ error: "Failed to fetch tables." });
    }
});

// 2. Add a table to a restaurant
app.post('/api/restaurants/:restaurant_id/tables', async (req, res) => {
    const { restaurant_id } = req.params;
    const { table_number, capacity, is_available } = req.body;
    
    if (!table_number || !capacity) {
        return res.status(400).json({ error: "Table number and capacity are required." });
    }
    
    try {
        const tableId = 'table-' + Date.now();
        const available = is_available === undefined ? true : (is_available === true || is_available === 'true');
        
        await pool.query(
            'INSERT INTO restaurant_tables (id, restaurant_id, table_number, capacity, is_available) VALUES ($1, $2, $3, $4, $5)',
            [tableId, restaurant_id, table_number, parseInt(capacity), available]
        );
        
        res.status(201).json({ id: tableId, restaurant_id, table_number, capacity, is_available: available });
    } catch (err) {
        console.error("Error adding table:", err);
        res.status(500).json({ error: "Failed to add table." });
    }
});

// 3. Toggle table availability
app.patch('/api/restaurants/:restaurant_id/tables/:table_id', async (req, res) => {
    const { restaurant_id, table_id } = req.params;
    const { is_available } = req.body;
    
    try {
        const available = is_available === true || is_available === 'true';
        const result = await pool.query(
            'UPDATE restaurant_tables SET is_available = $1 WHERE id = $2 AND restaurant_id = $3 RETURNING *',
            [available, table_id, restaurant_id]
        );
        
        if (result.rows.length > 0 || isLocalhostDb || !process.env.DATABASE_URL) {
            // Re-emit real-time event to let other connected clients know
            io.to(restaurant_id).emit('TABLE_STATUS_CHANGED', {
                table_id,
                is_available: available
            });
            res.json({ success: true, is_available: available });
        } else {
            res.status(404).json({ error: "Table not found." });
        }
    } catch (err) {
        console.error("Error toggling table availability:", err);
        res.status(500).json({ error: "Failed to update table availability." });
    }
});

// 4. Toggle menu item availability
app.patch('/api/restaurants/:restaurant_id/menu/:item_id', async (req, res) => {
    const { restaurant_id, item_id } = req.params;
    const { is_available } = req.body;
    
    try {
        const available = is_available === true || is_available === 'true';
        const result = await pool.query(
            'UPDATE menu_items SET is_available = $1 WHERE id = $2 AND restaurant_id = $3 RETURNING *',
            [available, item_id, restaurant_id]
        );
        
        if (result.rows.length > 0 || isLocalhostDb || !process.env.DATABASE_URL) {
            res.json({ success: true, is_available: available });
        } else {
            res.status(404).json({ error: "Menu item not found." });
        }
    } catch (err) {
        console.error("Error toggling menu availability:", err);
        res.status(500).json({ error: "Failed to update menu item availability." });
    }
});

// 5. Fetch all orders with details for a restaurant
app.get('/api/restaurants/:restaurant_id/orders', async (req, res) => {
    const { restaurant_id } = req.params;
    try {
        const ordersResult = await pool.query(
            `SELECT o.*, t.table_number AS reserved_table_number 
             FROM orders o 
             LEFT JOIN restaurant_tables t ON o.table_id = t.id 
             WHERE o.restaurant_id = $1 
             ORDER BY o.scheduled_fire_time DESC`,
            [restaurant_id]
        );
        
        const ordersWithItems = [];
        for (const order of ordersResult.rows) {
            const itemsResult = await pool.query(
                `SELECT oi.*, mi.name 
                 FROM order_items oi 
                 JOIN menu_items mi ON oi.menu_item_id = mi.id 
                 WHERE oi.order_id = $1`,
                [order.id]
            );
            ordersWithItems.push({
                ...order,
                items: itemsResult.rows
            });
        }
        
        res.json(ordersWithItems);
    } catch (err) {
        console.error("Error fetching restaurant orders:", err);
        res.status(500).json({ error: "Failed to fetch orders." });
    }
});

// 5b. Fetch single order with details
app.get('/api/orders/:order_id', async (req, res) => {
    const { order_id } = req.params;
    await ensureOrderExists(order_id);
    try {
        const orderResult = await pool.query(
            'SELECT * FROM orders WHERE id = $1',
            [order_id]
        );
        
        if (orderResult.rows.length === 0) {
            // fallback memory
            const memOrder = orders.find(o => o.id === order_id);
            if (!memOrder) return res.status(404).json({ error: "Order not found." });
            return res.json(memOrder);
        }
        
        const order = orderResult.rows[0];
        
        // Fetch items
        const itemsResult = await pool.query(
            `SELECT oi.*, mi.name 
             FROM order_items oi 
             JOIN menu_items mi ON oi.menu_item_id = mi.id 
             WHERE oi.order_id = $1`,
            [order.id]
        );
        
        order.items = itemsResult.rows;
        res.json(order);
    } catch (err) {
        console.error("Error fetching single order details:", err);
        res.status(500).json({ error: "Failed to fetch order details." });
    }
});

// 6. Update order status manually
app.patch('/api/orders/:order_id/status', async (req, res) => {
    const { order_id } = req.params;
    const { status } = req.body;
    
    if (!['PLACED', 'PREPARING', 'COMPLETED'].includes(status)) {
        return res.status(400).json({ error: "Invalid status." });
    }
    
    await ensureOrderExists(order_id);
    try {
        const result = await pool.query(
            'UPDATE orders SET order_status = $1 WHERE id = $2 RETURNING *',
            [status, order_id]
        );
        
        const orderData = result.rows[0] || orders.find(o => o.id === order_id);
        if (orderData) {
            // Emit to restaurant room
            io.to(orderData.restaurant_id).emit('ORDER_STATUS_CHANGED', {
                order_id: order_id,
                status: status
            });
            
            // If the status is completed, we can also emit ORDER_FULFILLED
            if (status === 'COMPLETED') {
                io.to(orderData.restaurant_id).emit('ORDER_FULFILLED', {
                    order_id: order_id,
                    message: "✅ Order successfully prepared and fulfilled by kitchen."
                });
            } else if (status === 'PREPARING') {
                io.to(orderData.restaurant_id).emit('NEW_KITCHEN_FIRE_ORDER', {
                    order_id: order_id,
                    type: orderData.fulfillment_type,
                    total: orderData.total_amount
                });
            }
        }
        
        res.json({ success: true, status });
    } catch (err) {
        console.error("Error updating order status:", err);
        res.status(500).json({ error: "Failed to update order status." });
    }
});

// AI Assistant Endpoint using @google/genai SDK (server-side ONLY)
let aiClient = null;
function getAiClient() {
    if (!aiClient) {
        const key = process.env.GEMINI_API_KEY;
        if (!key) {
            throw new Error("GEMINI_API_KEY environment variable is missing.");
        }
        aiClient = new GoogleGenAI({
            apiKey: key,
            httpOptions: {
                headers: {
                    'User-Agent': 'aistudio-build'
                }
            }
        });
    }
    return aiClient;
}

app.post('/api/ai-assistant', async (req, res) => {
    const { message, history, activeRoute, activeRestaurants } = req.body;
    
    if (!message) {
        return res.status(400).json({ error: "Message is required." });
    }

    try {
        let ai;
        try {
            ai = getAiClient();
        } catch (keyErr) {
            console.error("Gemini API key missing:", keyErr.message);
            return res.status(400).json({ 
                error: "Gemini API key is not configured. Please ask your workspace administrator to set the GEMINI_API_KEY in the Settings > Secrets menu." 
            });
        }

        // Prepare live details of restaurants, menus and tables
        const restaurantsWithDetails = restaurants.filter(r => r.is_active).map(r => {
            const clientMatchedRest = (activeRestaurants || []).find(ar => ar.id === r.id);
            return {
                id: r.id,
                name: r.name,
                address: r.address,
                latitude: r.latitude,
                longitude: r.longitude,
                average_prep_time: r.average_prep_time,
                is_near_route: clientMatchedRest ? !!clientMatchedRest.isNearRoute : false,
                route_distance_miles: clientMatchedRest && clientMatchedRest.routeDistanceMeters 
                    ? (clientMatchedRest.routeDistanceMeters / 1609.34).toFixed(1) + " miles" 
                    : null,
                menu: menu_items.filter(m => m.restaurant_id === r.id && m.is_available).map(m => ({
                    id: m.id,
                    name: m.name,
                    description: m.description,
                    price: parseFloat(m.price).toFixed(2)
                })),
                available_tables: tables.filter(t => t.restaurant_id === r.id && t.is_available).map(t => ({
                    id: t.id,
                    table_number: t.table_number,
                    capacity: t.capacity
                }))
            };
        });

        const systemInstruction = `You are the Route Food Sync AI Concierge, a helpful and engaging highway food guide and travel companion.
Your job is to help travelers analyze and choose the best partner diners along their route, recommend specific menu items matching their cravings or dietary restrictions, and suggest seating/tables.

CURRENT DYNAMIC ROADTRIP STATUS:
- Route Active: ${activeRoute ? "Yes" : "No"}
- Planned Route Info: ${activeRoute ? JSON.stringify(activeRoute) : "No planned route currently."}

LIVE DINER AND MENU DATABASE:
${JSON.stringify(restaurantsWithDetails, null, 2)}

DIRECTIONS & RULES:
1. Be concise, extremely helpful, and speak with a friendly, welcoming, professional tone. Keep responses within 2-3 short paragraphs if possible.
2. Filter your suggestions dynamically to focus on restaurants that are on the traveler's active route if a route is planned (marked as "is_near_route: true").
3. Make sure to recommend specific menu items and explain why they are a great choice (e.g. perfect warm roadtrip bite, quick 8-minute prep matching their ETA).
4. If they need seating, check the table capacities (e.g. "Table A has capacity for 4 guests") and suggest an available table.
5. NEVER recommend an item that is not in the menu list above, or a table that is not available.
6. **CRITICAL**: You can guide the client app to perform actions by outputting special markdown-style action links in your response. The web app will render these as interactive clickable buttons.
   Format:
   - To focus the map on a restaurant: [Focus on DinerName](action:focus:restaurantId)
   - To open the Preorder Menu of a restaurant: [Open Menu](action:menu:restaurantId)
   - To automatically configure a route: [Plan Route: Origin to Destination](action:setroute:OriginAddress:DestinationAddress)

Example formatting:
"I highly recommend the **Classic Trucker Burger** at [Pitstop Highway Diner](action:focus:f82e4f22-3816-4243-9a15-e642b8c2a0c0). You can check their [Preorder Menu](action:menu:f82e4f22-3816-4243-9a15-e642b8c2a0c0) to place a synchronized order."
"If you want to search along a new trip, let me know or [Plan Route from Hoboken to Bowenpally](action:setroute:Hoboken:Bowenpally) to find diners on the way!"`;

        const contents = [];
        if (history && history.length > 0) {
            history.forEach(item => {
                contents.push({
                    role: item.role === 'user' ? 'user' : 'model',
                    parts: [{ text: item.text }]
                });
            });
        }
        contents.push({
            role: 'user',
            parts: [{ text: message }]
        });

        const response = await ai.models.generateContent({
            model: "gemini-3.5-flash",
            contents: contents,
            config: {
                systemInstruction: systemInstruction,
                temperature: 0.7
            }
        });

        res.json({ text: response.text });
    } catch (error) {
        console.error("AI Assistant execution failed:", error);
        res.status(500).json({ error: "AI Assistant was unable to process your request." });
    }
});

function broadcastDemoStats() {
    try {
        const activeDemoOrders = orders.filter(o => o.is_demo && (o.order_status === 'PLACED' || o.order_status === 'PREPARING'));
        const uniqueRests = new Set(activeDemoOrders.map(o => o.restaurant_id));
        
        // GMV processed in last 60s:
        const now = Date.now();
        const demoOrdersLast60s = orders.filter(o => o.is_demo && (now - new Date(o.created_at || Date.now()).getTime() < 60000));
        const gmv60s = demoOrdersLast60s.reduce((sum, o) => sum + parseFloat(o.total_amount || 0), 0);
        
        io.emit('DEMO_STATS_UPDATE', {
            active_travelers: activeDemoOrders.length,
            engaged_restaurants: uniqueRests.size,
            gmv_60s: gmv60s
        });
    } catch (err) {
        console.error("Error broadcasting demo stats:", err);
    }
}

app.post('/api/demo/launch-network-demo', async (req, res) => {
    try {
        // Let's generate 18 to 28 virtual travelers
        const count = Math.floor(Math.random() * 11) + 18; // 18-28
        
        // Grab restaurants and menu items
        const dbRestaurants = restaurants; // in memory
        if (dbRestaurants.length === 0) {
            return res.status(400).json({ error: "No partner restaurants seeded yet." });
        }
        
        const travelerNames = [
            "Rohan Sharma", "Priya Patel", "Vikram Singh", "Ananya Reddy", 
            "Amit Verma", "Neha Gupta", "Sanjay Rao", "Deepika Sen", 
            "Arjun Nair", "Kavita Rao", "Karan Malhotra", "Sneha Joshi",
            "Rahul Dravid", "Aditi Rao", "Vijay Kumar", "Riya Sen",
            "Abhishek Roy", "Meera Nair", "Rajesh Patel", "Sunita Nair"
        ];

        // We will schedule order insertions staggered over ~30-45 seconds
        for (let i = 0; i < count; i++) {
            const delay = i * 1500; // Place an order every 1.5 seconds
            
            setTimeout(async () => {
                try {
                    const travelerName = travelerNames[Math.floor(Math.random() * travelerNames.length)] + ` (${Math.floor(Math.random() * 900 + 100)})`;
                    const restaurant = dbRestaurants[Math.floor(Math.random() * dbRestaurants.length)];
                    
                    // Filter menu items for this restaurant
                    const items = menu_items.filter(mi => mi.restaurant_id === restaurant.id);
                    if (items.length === 0) return;
                    
                    // Pick 1-2 random items
                    const numItems = Math.floor(Math.random() * 2) + 1;
                    const selectedItems = [];
                    let totalAmount = 0;
                    
                    for (let j = 0; j < numItems; j++) {
                        const item = items[Math.floor(Math.random() * items.length)];
                        if (!selectedItems.some(si => si.menu_item_id === item.id)) {
                            const quantity = Math.floor(Math.random() * 2) + 1;
                            selectedItems.push({
                                menu_item_id: item.id,
                                name: item.name,
                                quantity: quantity,
                                price: item.price
                            });
                            totalAmount += item.price * quantity;
                        }
                    }
                    
                    const initial_eta_minutes = Math.floor(Math.random() * 36) + 5; // 5-40 mins
                    const fulfillment_type = Math.random() < 0.7 ? 'DINE_IN' : 'PICKUP';
                    const orderId = 'order-demo-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
                    
                    const currentTime = new Date();
                    const driverArrivalTimestamp = new Date(currentTime.getTime() + initial_eta_minutes * 60 * 1000);
                    const scheduledFireTimestamp = new Date(driverArrivalTimestamp.getTime() - restaurant.average_prep_time * 60 * 1000);
                    
                    // Construct demo order object
                    const newOrder = {
                        id: orderId,
                        user_id: 'mock-user-id',
                        restaurant_id: restaurant.id,
                        total_amount: parseFloat(totalAmount.toFixed(2)),
                        fulfillment_type: fulfillment_type,
                        current_driver_eta: driverArrivalTimestamp,
                        scheduled_fire_time: scheduledFireTimestamp,
                        order_status: 'PLACED',
                        escrow_status: 'HOLD',
                        is_demo: true,
                        created_at: new Date(),
                        table_id: fulfillment_type === 'DINE_IN' ? (tables.find(t => t.restaurant_id === restaurant.id && t.is_available)?.id || null) : null
                    };
                    
                    // Push to memory
                    orders.push(newOrder);
                    
                    // Insert order items into memory
                    selectedItems.forEach(item => {
                        order_items.push({
                            order_id: orderId,
                            menu_item_id: item.menu_item_id,
                            quantity: item.quantity,
                            price_at_purchase: item.price
                        });
                    });
                    
                    // Insert into DB if Postgres is connected
                    if (process.env.DATABASE_URL && !isLocalhostDb) {
                        try {
                            await pool.query(
                                `INSERT INTO orders (id, user_id, restaurant_id, total_amount, fulfillment_type, current_driver_eta, scheduled_fire_time, order_status, escrow_status, is_demo, table_id)
                                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                                [orderId, 'mock-user-id', restaurant.id, newOrder.total_amount, fulfillment_type, driverArrivalTimestamp, scheduledFireTimestamp, 'PLACED', 'HOLD', true, newOrder.table_id]
                            );
                            
                            for (const item of selectedItems) {
                                await pool.query(
                                    `INSERT INTO order_items (order_id, menu_item_id, quantity, price_at_purchase)
                                     VALUES ($1, $2, $3, $4)`,
                                    [orderId, item.menu_item_id, item.quantity, item.price]
                                );
                            }
                        } catch (pgErr) {
                            console.error("PG Insertion failed for demo order, using memory fallback:", pgErr.message);
                        }
                    }
                    
                    saveMockDb();
                    
                    // 1. Emit ORDER_PLACED
                    io.emit('ORDER_PLACED', {
                        order_id: orderId,
                        restaurant_id: restaurant.id,
                        restaurant_name: restaurant.name,
                        total_amount: newOrder.total_amount,
                        scheduled_fire_time: scheduledFireTimestamp,
                        status: 'PLACED'
                    });
                    
                    broadcastDemoStats();
                    
                    // 2. Schedule Schedule Update (3s)
                    setTimeout(() => {
                        io.emit('ORDER_SCHEDULE_UPDATED', {
                            order_id: orderId,
                            updated_eta_minutes: initial_eta_minutes,
                            scheduled_fire_time: scheduledFireTimestamp
                        });
                    }, 3000);
                    
                    // 3. Schedule Failsafe random alert (6s)
                    if (Math.random() < 0.2) {
                        setTimeout(() => {
                            io.emit('ORDER_FAILSAFE_ACTIVE', {
                                order_id: orderId
                            });
                        }, 6000);
                    }
                    
                    // 4. Schedule ETA Update (9s)
                    setTimeout(() => {
                        io.emit('ORDER_ETA_UPDATED', {
                            order_id: orderId,
                            updated_eta_minutes: Math.max(3, initial_eta_minutes - 2)
                        });
                    }, 9000);
                    
                    // 5. Schedule Kitchen Fire (15s)
                    setTimeout(() => {
                        newOrder.order_status = 'PREPARING';
                        saveMockDb();
                        
                        io.to(restaurant.id).emit('NEW_KITCHEN_FIRE_ORDER', {
                            order_id: orderId,
                            type: fulfillment_type,
                            total: newOrder.total_amount
                        });
                        io.emit('NEW_KITCHEN_FIRE_ORDER', {
                            order_id: orderId,
                            type: fulfillment_type,
                            total: newOrder.total_amount
                        });
                        
                        broadcastDemoStats();
                    }, 15000);
                    
                    // 6. Schedule Fulfill (30s)
                    setTimeout(() => {
                        newOrder.order_status = 'COMPLETED';
                        newOrder.escrow_status = 'RELEASED';
                        saveMockDb();
                        
                        io.emit('ORDER_FULFILLED', {
                            order_id: orderId,
                            total_amount: newOrder.total_amount,
                            restaurant_id: restaurant.id
                        });
                        
                        broadcastDemoStats();
                    }, 30000);
                    
                } catch (err) {
                    console.error("Error running individual demo order timer:", err);
                }
            }, delay);
        }
        
        res.json({ success: true, message: `Successfully launched simulation of ${count} virtual travelers!` });
        
    } catch (error) {
        console.error("Failed to launch network demo:", error);
        res.status(500).json({ error: "Failed to initiate live network simulation." });
    }
});

app.post('/api/demo/reset-demo-data', async (req, res) => {
    try {
        // 1. Delete from PostgreSQL if active
        if (process.env.DATABASE_URL && !isLocalhostDb) {
            try {
                await pool.query('DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE is_demo = TRUE)');
                await pool.query('DELETE FROM orders WHERE is_demo = TRUE');
            } catch (pgErr) {
                console.error("PG Demo Reset failed, falling back to memory:", pgErr.message);
            }
        }
        
        // 2. Delete from memory lists
        const demoOrderIds = orders.filter(o => o.is_demo).map(o => o.id);
        for (let i = orders.length - 1; i >= 0; i--) {
            if (orders[i].is_demo) {
                orders.splice(i, 1);
            }
        }
        for (let i = order_items.length - 1; i >= 0; i--) {
            if (demoOrderIds.includes(order_items[i].order_id)) {
                order_items.splice(i, 1);
            }
        }
        
        saveMockDb();
        
        // Emit general reset event so client screens refresh stats and reload charts
        io.emit('DEMO_DATA_RESET');
        broadcastDemoStats();
        
        res.json({ success: true, message: "Demo data cleared successfully. Dashboard is back to baseline." });
    } catch (error) {
        console.error("Reset Demo Data Error:", error);
        res.status(500).json({ error: "Failed to clear demo records." });
    }
});

// Serve static files from root directory
app.use(express.static(path.join(__dirname, '.')));

// Fallback to serve index.html for root path
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// START RUNNING THE INTEGRATED WEB SERVER
const PORT = 3000; // Force exactly port 3000 as required by AI Studio constraints

// =======================================================
// 📊 INVESTOR LIVE SHOWCASE PERFORMANCE DIAGNOSTICS
// =======================================================
app.get('/api/investor/pitch-metrics', async (req, res) => {
    try {
        // Read directly from your live, lightweight file-backed data store
        const dataRaw = await fs.promises.readFile(MOCK_DB_PATH, 'utf8');
        const db = JSON.parse(dataRaw);
        
        const totalOrders = db.orders.length;
        const completedOrders = db.orders.filter(o => o.order_status === 'COMPLETED').length;
        const escrowLocked = db.orders.filter(o => o.escrow_status === 'HOLD').length;
        
        // Calculate dynamic valuation metrics on the fly
        const totalVolume = db.orders.reduce((sum, o) => sum + (parseFloat(o.total_amount) || 0), 0);
        const marketplaceRevenue = totalVolume * 0.10; // Your 10% platform cut
        
        res.json({
            status: "HEALTHY",
            metrics: {
                total_network_traffic: totalOrders,
                successful_fulfillments: completedOrders,
                active_secure_escrow_holds: escrowLocked,
                gross_merchandise_value: `₹${totalVolume.toFixed(2)}`,
                platform_net_revenue: `₹${marketplaceRevenue.toFixed(2)}`,
                carbon_mitigation_index: `${(completedOrders * 3.4).toFixed(1)} kg CO2`
            }
        });
    } catch (err) {
        res.status(500).json({ error: "Failed to gather real-time network analytics." });
    }
});

// TEST ROUTE: Trigger a manual fire signal to a restaurant room
app.get('/api/test/fire-order/:restaurant_id', (req, res) => {
    const { restaurant_id } = req.params;
    
    // Manually push a test order to the dashboard
    io.to(restaurant_id).emit('NEW_KITCHEN_FIRE_ORDER', {
        order_id: "TEST-12345",
        type: "DINE_IN",
        total: 25.50
    });
    
    res.send(`Test signal sent to room: ${restaurant_id}`);
});

server.listen(PORT, '0.0.0.0', () => console.log(`🚀 Scalable Real-time Server active on port ${PORT} at host 0.0.0.0`));
