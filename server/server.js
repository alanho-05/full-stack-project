import 'dotenv/config';
import express from 'express';
import errorMiddleware from './lib/error-middleware.js';
import ClientError from './lib/client-error.js';
// eslint-disable-next-line no-unused-vars -- Remove when used
import { authMiddleware } from './lib/authorization-middleware.js';
import pg from 'pg';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import Stripe from 'stripe';

const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const app = express();

// Create paths for static directories
const reactStaticDir = new URL('../client/build', import.meta.url).pathname;
const uploadsStaticDir = new URL('public', import.meta.url).pathname;

app.use(express.static(reactStaticDir));
// Static directory for file uploads server/public/
app.use(express.static(uploadsStaticDir));
app.use(express.json());

app.get('/api/products/weapons', async (req, res, next) => {
  try {
    const sql = `
      select "productId",
             "name",
             "price",
             "imageUrl"
        from "products"
       where "type" = 'weapon'
       order by "name"
    `;
    const result = await db.query(sql);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    next(err);
  }
});

app.get('/api/products/vehicles', async (req, res, next) => {
  try {
    const sql = `
      select "productId",
             "name",
             "price",
             "imageUrl"
        from "products"
       where "type" = 'vehicle'
       order by "name"
    `;
    const result = await db.query(sql);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    next(err);
  }
});

app.get('/api/products/throwables', async (req, res, next) => {
  try {
    const sql = `
      select "productId",
             "name",
             "price",
             "imageUrl"
        from "products"
       where "type" = 'throwable'
       order by "name"
    `;
    const result = await db.query(sql);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    next(err);
  }
});

app.get('/api/products/:productId', async (req, res, next) => {
  try {
    const productId = Number(req.params.productId);
    if (!productId) {
      throw new ClientError(400, 'productId must be a positive integer');
    }
    const sql = `
      select "productId",
             "name",
             "price",
             "imageUrl",
             "description"
        from "products"
       where "productId" = $1
    `;
    const params = [productId];
    const result = await db.query(sql, params);
    if (!result.rows[0]) {
      throw new ClientError(
        404,
        `cannot find product with productId ${productId}`
      );
    }
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

app.get('/api/cart/:userId', async (req, res, next) => {
  try {
    const userId = req.params.userId;
    const sql = `
      select *
        from "products"
        join "shoppingCartItem" using ("productId")
        join "shoppingCart" using ("shoppingCartId")
        join "users" using ("userId")
       where "users"."userId" = $1
    `;
    const params = [userId];
    const result = await db.query(sql, params);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

app.post('/api/cart/addtocart', async (req, res, next) => {
  try {
    const { productId, quantity, shoppingCartId } = req.body;
    const sql = `
      insert into "shoppingCartItem" ("productId", "quantity", "shoppingCartId")
      values ($1, $2, $3)
      returning *
    `;
    const params = [productId, quantity, shoppingCartId];
    const result = await db.query(sql, params);
    const [cart] = result.rows;
    res.status(201).json(cart);
  } catch (err) {
    next(err);
  }
});

app.post('/api/cart/removeitem', async (req, res, next) => {
  try {
    const { productId, shoppingCartId } = req.body;
    const sql = `
      delete
        from "shoppingCartItem"
       where "productId" = $1
         and "shoppingCartId" = $2
    `;
    const params = [productId, shoppingCartId];
    await db.query(sql, params);
    res.sendStatus(204);
  } catch (err) {
    next(err);
  }
});

app.post('/api/checkout', async (req, res, next) => {
  try {
    const { cart } = req.body;
    const lineItems = [];
    cart.forEach((item) => {
      lineItems.push({
        price: item.stripeId,
        quantity: item.quantity,
      });
    });
    const session = await stripe.checkout.sessions.create({
      line_items: lineItems,
      mode: 'payment',
      success_url: 'http://localhost:3000/success',
      cancel_url: 'http://localhost:3000/cancel',
    });
    res.json({ url: session.url });
  } catch (err) {
    next(err);
  }
});

app.post('/api/auth/sign-up', async (req, res, next) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      throw new ClientError(400, 'username and password are required fields');
    }
    const hashedPassword = await argon2.hash(password);
    const sql = `
      insert into "users" ("username", "hashedPassword")
      values ($1, $2)
      returning *
    `;
    const params = [username, hashedPassword];
    const result = await db.query(sql, params);
    const [user] = result.rows;
    const cartSql = `
      insert into "shoppingCart" ("userId")
      values ($1)
      returning *
    `;
    const cartParams = [user.userId];
    await db.query(cartSql, cartParams);
    res.status(201).json(user);
  } catch (err) {
    next(err);
  }
});

app.post('/api/auth/sign-in', async (req, res, next) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      throw new ClientError(401, 'invalid login');
    }
    const sql = `
      select "userId",
             "hashedPassword",
             "shoppingCartId"
        from "users"
        join "shoppingCart" using ("userId")
       where "username" = $1
    `;
    const params = [username];
    const result = await db.query(sql, params);
    const [user] = result.rows;
    if (!user) {
      throw new ClientError(401, 'invalid login');
    }

    const { userId, hashedPassword, shoppingCartId } = user;

    if (!(await argon2.verify(hashedPassword, password))) {
      throw new ClientError(401, 'invalid login');
    }
    const payload = { userId, username, shoppingCartId };
    const token = jwt.sign(payload, process.env.TOKEN_SECRET);
    res.json({ token, user: payload });
  } catch (err) {
    next(err);
  }
});

app.get('/api/hello', (req, res) => {
  res.json({ message: 'Hello, Project!' });
});

/**
 * Serves React's index.html if no api route matches.
 *
 * Implementation note:
 * When the final project is deployed, this Express server becomes responsible
 * for serving the React files. (In development, the Create React App server does this.)
 * When navigating in the client, if the user refreshes the page, the browser will send
 * the URL to this Express server instead of to React Router.
 * Catching everything that doesn't match a route and serving index.html allows
 * React Router to manage the routing.
 */
app.get('*', (req, res) => res.sendFile(`${reactStaticDir}/index.html`));

app.use(errorMiddleware);

app.listen(process.env.PORT, () => {
  process.stdout.write(`\n\napp listening on port ${process.env.PORT}\n\n`);
});
