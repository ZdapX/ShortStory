
const express = require('express');
const { Redis } = require('@upstash/redis');
const bodyParser = require('body-parser');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const session = require('cookie-session');

const app = express();

const redis = new Redis({
  url: 'https://enough-kodiak-11567.upstash.io',
  token: 'AS0vAAIncDEzZTZhMzRiZjAzNWU0NzMwOTNhZGJjYTkxMzIxYjVhM3AxMTE1Njc',
});

app.set('view engine', 'ejs');
app.set('views', path.join(process.cwd(), 'views'));
app.use(express.static(path.join(process.cwd(), 'public')));
app.use(bodyParser.urlencoded({ extended: true, limit: '20mb' }));
app.use(bodyParser.json({ limit: '20mb' }));

app.use(session({
    name: 'session',
    keys: ['secretstorykey'],
    maxAge: 24 * 60 * 60 * 1000
}));

app.use(async (req, res, next) => {
    res.locals.user = req.session.user || null;
    next();
});

const checkAuth = (req, res, next) => {
    if (!req.session.user) return res.redirect('/login');
    next();
};

// --- AUTH ---
app.get('/login', (req, res) => res.render('login', { error: null }));
app.get('/register', (req, res) => res.render('register', { error: null }));

app.post('/register', async (req, res) => {
    const { username, password, name } = req.body;
    try {
        const userId = uuidv4();
        const existing = await redis.hget('users_map', username);
        if (existing) return res.render('register', { error: 'Username sudah dipakai' });

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = { id: userId, username, password: hashedPassword, name, profilePic: '' };
        
        await redis.hset('users', { [userId]: JSON.stringify(newUser) });
        await redis.hset('users_map', { [username]: userId });
        res.redirect('/login');
    } catch (e) { res.render('register', { error: 'Error sistem' }); }
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const userId = await redis.hget('users_map', username);
        if (!userId) return res.render('login', { error: 'User tidak ditemukan' });

        const userData = await redis.hget('users', userId);
        const user = typeof userData === 'string' ? JSON.parse(userData) : userData;
        
        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) return res.render('login', { error: 'Password salah' });

        req.session.user = { id: user.id, name: user.name, username: user.username };
        res.redirect('/');
    } catch (e) { res.render('login', { error: 'Login gagal' }); }
});

app.get('/logout', (req, res) => { req.session = null; res.redirect('/'); });

// --- STORIES ---
app.get('/', async (req, res) => {
    try {
        const { search, genre } = req.query;
        // Gunakan hvals untuk mengambil isi tanpa Key (Lebih ringan sedikit)
        const allData = await redis.hvals('stories') || [];
        let stories = allData.map(s => typeof s === 'string' ? JSON.parse(s) : s);

        if (genre) stories = stories.filter(s => s.genre === genre);
        if (search) stories = stories.filter(s => s.title.toLowerCase().includes(search.toLowerCase()));

        res.render('index', { stories: stories.reverse(), search: search || '', currentGenre: genre || '' });
    } catch (err) { res.render('index', { stories: [], search: '', currentGenre: '' }); }
});

app.get('/upload', checkAuth, (req, res) => res.render('upload'));

app.post('/upload', checkAuth, async (req, res) => {
    try {
        const { title, genre, storyText, coverImg, coverImgFile } = req.body;
        const id = uuidv4();
        const userId = req.session.user.id;
        const userFullData = await redis.hget('users', userId);
        const userFull = typeof userFullData === 'string' ? JSON.parse(userFullData) : userFullData;

        const newStory = {
            id,
            title,
            genre,
            storyText,
            authorId: userId,
            authorName: userFull.name,
            authorImg: userFull.profilePic || `https://ui-avatars.com/api/?name=${userFull.name}`,
            coverImg: coverImgFile || coverImg || 'https://via.placeholder.com/400x250',
            createdAt: new Date().toLocaleDateString('id-ID'),
            likes: [],
            comments: []
        };

        // SIMPAN CERITA
        await redis.hset('stories', { [id]: JSON.stringify(newStory) });
        // SIMPAN INDEX (Agar profil tidak timeout) - Mencatat ID cerita ke milik user
        await redis.sadd(`user_stories_idx:${userId}`, id);
        
        res.redirect('/');
    } catch (err) { res.status(500).send("Gagal upload"); }
});

// --- PROFILE (OPTIMIZED) ---
app.get('/profile/:id', async (req, res) => {
    try {
        const userId = req.params.id;
        
        // 1. Ambil data User
        const userData = await redis.hget('users', userId);
        if (!userData) return res.redirect('/');
        const profile = typeof userData === 'string' ? JSON.parse(userData) : userData;

        // 2. Ambil ID cerita milik user ini saja (Menggunakan INDEX)
        const storyIds = await redis.smembers(`user_stories_idx:${userId}`) || [];
        
        let stories = [];
        if (storyIds.length > 0) {
            // Ambil hanya cerita yang ID nya ada di daftar user ini
            const rawStories = await redis.hmget('stories', ...storyIds);
            stories = rawStories
                .filter(s => s !== null)
                .map(s => typeof s === 'string' ? JSON.parse(s) : s);
        }
        
        // 3. Follow stats
        const followers = await redis.smembers(`followers:${userId}`) || [];
        let isFollowing = false;
        if(req.session.user) {
            isFollowing = await redis.sismember(`following:${req.session.user.id}`, userId);
        }

        res.render('profile', { 
            profile, 
            stories: stories.reverse(), 
            followersCount: followers.length,
            isFollowing
        });
    } catch (e) {
        console.error(e);
        res.redirect('/');
    }
});

// Fitur Like & Comment (Sama seperti sebelumnya)
app.post('/story/:id/like', checkAuth, async (req, res) => {
    const data = await redis.hget('stories', req.params.id);
    const story = typeof data === 'string' ? JSON.parse(data) : data;
    const userId = req.session.user.id;
    if (!story.likes) story.likes = [];
    if (story.likes.includes(userId)) story.likes = story.likes.filter(i => i !== userId);
    else story.likes.push(userId);
    await redis.hset('stories', { [req.params.id]: JSON.stringify(story) });
    res.json({ count: story.likes.length });
});

app.post('/story/:id/comment', checkAuth, async (req, res) => {
    const data = await redis.hget('stories', req.params.id);
    const story = typeof data === 'string' ? JSON.parse(data) : data;
    story.comments.push({ userName: req.session.user.name, text: req.body.text, date: new Date().toLocaleDateString() });
    await redis.hset('stories', { [req.params.id]: JSON.stringify(story) });
    res.redirect(`/story/${req.params.id}`);
});

app.get('/story/:id', async (req, res) => {
    const data = await redis.hget('stories', req.params.id);
    if(!data) return res.redirect('/');
    res.render('story', { story: typeof data === 'string' ? JSON.parse(data) : data });
});

app.get('/settings', checkAuth, async (req, res) => {
    const data = await redis.hget('users', req.session.user.id);
    res.render('settings', { userFull: typeof data === 'string' ? JSON.parse(data) : data });
});

app.post('/settings', checkAuth, async (req, res) => {
    const { name, profilePicFile } = req.body;
    const userId = req.session.user.id;
    const data = await redis.hget('users', userId);
    const userFull = typeof data === 'string' ? JSON.parse(data) : data;
    userFull.name = name;
    if (profilePicFile) userFull.profilePic = profilePicFile;
    await redis.hset('users', { [userId]: JSON.stringify(userFull) });
    req.session.user.name = name;
    res.redirect(`/profile/${userId}`);
});

app.post('/follow/:id', checkAuth, async (req, res) => {
    const myId = req.session.user.id;
    const targetId = req.params.id;
    if (myId === targetId) return res.json({ error: true });
    const isFollowing = await redis.sismember(`following:${myId}`, targetId);
    if (isFollowing) {
        await redis.srem(`following:${myId}`, targetId);
        await redis.srem(`followers:${targetId}`, myId);
    } else {
        await redis.sadd(`following:${myId}`, targetId);
        await redis.sadd(`followers:${targetId}`, myId);
    }
    res.json({ ok: true });
});

module.exports = app;
if (process.env.NODE_ENV !== 'production') app.listen(3000);
