const { Pool } = require('pg');
require('dotenv').config();

// Initialize PostgreSQL Connection using your .env credentials
const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

async function seedDatabase() {
    try {
        console.log('🌱 Starting database seeding process...');

        // 1. Insert a Mock Traveler/User
        const userQuery = `
            INSERT INTO users (name, email, phone)
            VALUES ($1, $2, $3)
            ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
            RETURNING id;
        `;
        const userRes = await pool.query(userQuery, ['Alex Driver', 'alex@traveler.com', '+1-555-0199']);
        const userId = userRes.rows[0].id;
        console.log(`👤 Mock User created with ID: ${userId}`);

        // 2. Insert a Mock Partner Restaurant Along a Highway Corridor
        // Example coordinates roughly placing a diner right off a main route
        const restaurantQuery = `
            INSERT INTO restaurants (name, address, latitude, longitude, average_prep_time, is_active)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id;
        `;
        const restaurantRes = await pool.query(restaurantQuery, [
            'Pitstop Highway Diner',
            '456 Interstate Route 95, Exit 12',
            40.7128, // Example Latitude
            -74.0060, // Example Longitude
            15, // 15-minute average kitchen prep speed
            true
        ]);
        const restaurantId = restaurantRes.rows[0].id;
        console.log(`🍔 Mock Restaurant created with ID: ${restaurantId}`);

        // 3. Insert Mock Menu Items Linked to Our New Restaurant
        const menuQuery = `
            INSERT INTO menu_items (restaurant_id, name, description, price, is_available)
            VALUES 
            ($1, $2, $3, $4, $5),
            ($1, $6, $7, $8, $5)
            RETURNING id, name;
        `;
        const menuRes = await pool.query(menuQuery, [
            restaurantId,
            'Classic Trucker Burger', 'Juicy beef patty with cheddar cheese, lettuce, and secret sauce. Comes with fries.', 14.99, true,
            'Roadtrip Iced Coffee', 'Freshly brewed cold brew over ice with vanilla sweet cream.', 4.50
        ]);

        console.log('📋 Mock Menu Items Created:');
        menuRes.rows.forEach(item => {
            console.log(`   - ${item.name} (ID: ${item.id})`);
        });

        console.log('\n✅ Database seeding completed successfully! Your data environment is ready.');

    } catch (error) {
        console.error('❌ Error seeding data structures:', error);
    } finally {
        // Safely shut down database pool connection
        await pool.end();
    }
}

// Execute the automation script
seedDatabase();