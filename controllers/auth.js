import bcrypt from 'bcrypt';
import crypto from 'crypto';
import pool from '../config/database.js';

export async function loginUser(req, res) {
  const { username, password, rememberMe } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  
  try {
    const result = await pool.query(
      'SELECT * FROM users WHERE username = $1',
      [username]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const user = result.rows[0];
    const passwordMatch = await bcrypt.compare(password, user.password);

    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const userForClient = {
      id: user.id,
      username: user.username,
      role: user.role
    };

    // Generate JWT (access token)
    const jwt = (await import('jsonwebtoken')).default;
    const jwtSecret = process.env.JWT_SECRET || 'your-very-secret-key';
    const accessToken = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      jwtSecret,
      { expiresIn: '15m' }
    );

    // Generate refresh token
    const refreshToken = crypto.randomBytes(64).toString('hex');
    const refreshExpires = rememberMe
      ? new Date(Date.now() + 1000 * 60 * 60 * 24 * 30) // 30 days
      : undefined;

    // Store refresh token in DB (always set expiry in DB, use 30d or 7d default)
    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET token = $2, expires_at = $3`,
      [user.id, refreshToken, refreshExpires || new Date(Date.now() + 1000 * 60 * 60 * 24 * 7)]
    );

    // Set refresh token as HttpOnly cookie
    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      ...(refreshExpires ? { expires: refreshExpires } : {}),
      path: '/api/auth',
    });

    res.json({ success: true, user: userForClient, token: accessToken });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function logoutUser(req, res) {
  // JWT logout is handled client-side by removing the token
  // Invalidate refresh token in DB and clear cookie
  try {
    const refreshToken = req.cookies.refresh_token;
    if (refreshToken) {
      await pool.query('DELETE FROM refresh_tokens WHERE token = $1', [refreshToken]);
    }
    res.clearCookie('refresh_token', { path: '/api/auth' });
    res.json({ success: true });
  } catch (err) {
    console.error('Logout error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export function getMe(req, res) {
  if (req.user) {
    // Always return a name field for frontend display
    res.json({
      ...req.user,
      name: req.user.name || req.user.username || ''
    });
  } else {
    res.status(401).json({ error: 'Not authenticated' });
  }
}

export async function refreshToken(req, res) {
  const refreshToken = req.cookies.refresh_token;
  if (!refreshToken) {
    return res.status(401).json({ error: 'No refresh token' });
  }
  try {
    // Find refresh token in DB
    const result = await pool.query(
      'SELECT * FROM refresh_tokens WHERE token = $1 AND expires_at > NOW()',
      [refreshToken]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }
    const userId = result.rows[0].user_id;
    // Get user
    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }
    const user = userResult.rows[0];
    // Issue new access token
    const jwt = (await import('jsonwebtoken')).default;
    const jwtSecret = process.env.JWT_SECRET || 'your-very-secret-key';
    const accessToken = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      jwtSecret,
      { expiresIn: '15m' }
    );
    // Rotate refresh token
    const newRefreshToken = crypto.randomBytes(64).toString('hex');
    const refreshExpires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7); // 7 days
    await pool.query(
      'UPDATE refresh_tokens SET token = $1, expires_at = $2 WHERE user_id = $3',
      [newRefreshToken, refreshExpires, user.id]
    );
    res.cookie('refresh_token', newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      expires: refreshExpires,
      path: '/api/auth',
    });
    res.json({ token: accessToken });
  } catch (err) {
    console.error('Refresh token error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function createUser(req, res) {
  const { username, password, role } = req.body;
  if (!username || !password || !role) {
    return res.status(400).json({ error: 'Username, password, and role are required' });
  }
  try {
    const hashed = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (username, password, role, created_at) VALUES ($1, $2, $3, NOW()) RETURNING id, username, role, created_at',
      [username, hashed, role]
    );
    // Log admin action
    if (req.user && req.user.username) {
      await pool.query(
        'INSERT INTO admin_logs (action, actor, target, details) VALUES ($1, $2, $3, $4)',
        ['create_user', req.user.username, username, JSON.stringify({ role })]
      );
    }
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Username already exists' });
    }
    console.error('Error creating user:', err);
    res.status(500).json({ error: 'Failed to create user' });
  }
}

export async function deleteUser(req, res) {
  const { id } = req.params;
  if (!id) return res.status(400).json({ error: 'User id required' });
  try {
    const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id, username, role', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    // Log admin action
    if (req.user && req.user.username) {
      await pool.query(
        'INSERT INTO admin_logs (action, actor, target, details) VALUES ($1, $2, $3, $4)',
        ['delete_user', req.user.username, id, JSON.stringify({})]
      );
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error deleting user:', err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
} 