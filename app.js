
const express = require('express');
const { Redis } = require('@upstash/redis');
const bodyParser = require('body-parser');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const session = require('cookie-session');

const app = express();

// Konfigurasi Database Upstash
const redis = new Redis({
  url: 'https://enough-kodiak-11567.upstash.io',
  token: 'AS0vAAIncDEzZTZhMzRiZjAzNWU0NzMwOTNhZGJjYTkxMzIxYjVhM3AxMTE1Njc',
});

// Middleware & View Engine
app.set('view engine', 'ejs');
app.set('views', path.join(process.cwd(), 'views'));
app.use(express.static(path.join(process.cwd(), 'public')));
app.use(bodyParser.urlencoded({ extended: true, limit: '20mb' }));
app.use(bodyParser.json({ limit: '20mb' }));

// Konfigurasi Session (Agar Login di Vercel Awet)
app.use(session({
    name: 'story_session',
    keys: ['flash-story-key-2025'],
    maxAge: 24 * 60 * 60 * 1000 // 24 Jam
}));

// Global Variable untuk EJS (User & Genre)
app.use(async (req, res, next) => {
    res.locals.user = req.session.user || null;
    next();
});

// Middleware Proteksi Login
const checkAuth = (req, res, next) => {
    if (!req.session.user) return res.redirect('/login');
    next();
};

// --- AUTHENTICATION ---

app.get('/login', (req, res) => res.render('login', { error: null }));
app.get('/register', (req, res) => res.render('register', { error: null }));

app.post('/register', async (req, res) => {
    const { username, password, name } = req.body;
    try {
        const userId = uuidv4();
        const existing = await redis.hget('users_map', username.toLowerCase());
        if (existing) return res.render('register', { error: 'Username sudah digunakan' });

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = { id: userId, username: username.toLowerCase(), password: hashedPassword, name, profilePic: '' };
        
        await redis.hset('users', { [userId]: JSON.stringify(newUser) });
        await redis.hset('users_map', { [username.toLowerCase()]: userId });
        res.redirect('/login');
    } catch (e) { res.render('register', { error: 'Terjadi kesalahan sistem' }); }
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const userId = await redis.hget('users_map', username.toLowerCase());
        if (!userId) return res.render('login', { error: 'Username tidak terdaftar' });

        const userData = await redis.hget('users', userId);
        const user = typeof userData === 'string' ? JSON.parse(userData) : userData;
        
        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) return res.render('login', { error: 'Password salah' });

        req.session.user = { id: user.id, name: user.name, username: user.username };
        res.redirect('/');
    } catch (e) { res.render('login', { error: 'Gagal masuk' }); }
});

app.get('/logout', (req, res) => { req.session = null; res.redirect('/'); });

// --- STORIES LOGIC ---

app.get('/', async (req, res) => {
    try {
        const { search, genre } = req.query;
        const allData = await redis.hvals('stories') || [];
        let stories = allData.map(s => typeof s === 'string' ? JSON.parse(s) : s);

        if (genre) stories = stories.filter(s => s.genre === genre);
        if (search) stories = stories.filter(s => 
            (s.title && s.title.toLowerCase().includes(search.toLowerCase())) ||
            (s.authorName && s.authorName.toLowerCase().includes(search.toLowerCase()))
        );

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

        await redis.hset('stories', { [id]: JSON.stringify(newStory) });
        await redis.sadd(`user_stories_idx:${userId}`, id); // Index untuk profil
        
        res.redirect('/');
    } catch (err) { res.status(500).send("Gagal publikasi cerita"); }
});

app.get('/story/:id', async (req, res) => {
    try {
        const data = await redis.hget('stories', req.params.id);
        if(!data) return res.redirect('/');
        res.render('story', { story: typeof data === 'string' ? JSON.parse(data) : data });
    } catch (e) { res.redirect('/'); }
});

app.post('/story/delete/:id', checkAuth, async (req, res) => {
    try {
        const data = await redis.hget('stories', req.params.id);
        const story = typeof data === 'string' ? JSON.parse(data) : data;
        if (story.authorId !== req.session.user.id) return res.status(403).send("Ilegal");

        await redis.hdel('stories', req.params.id);
        await redis.srem(`user_stories_idx:${req.session.user.id}`, req.params.id);
        res.redirect(`/profile/${req.session.user.id}`);
    } catch (e) { res.redirect('/'); }
});

// --- INTERACTIONS ---

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
    if (!story.comments) story.comments = [];
    
    story.comments.push({ 
        userName: req.session.user.name, 
        text: req.body.text, 
        date: new Date().toLocaleDateString() 
    });
    
    await redis.hset('stories', { [req.params.id]: JSON.stringify(story) });
    res.redirect(`/story/${req.params.id}`);
});

// --- PROFILE & SETTINGS ---

app.get('/profile/:id', async (req, res) => {
    try {
        const userId = req.params.id;
        const userData = await redis.hget('users', userId);
        if (!userData) return res.redirect('/');
        const profile = typeof userData === 'string' ? JSON.parse(userData) : userData;

        const storyIds = await redis.smembers(`user_stories_idx:${userId}`);
        let stories = [];
        if (storyIds && storyIds.length > 0) {
            // Mengambil satu per satu untuk menghindari timeout
            const rawStories = await Promise.all(storyIds.map(sid => redis.hget('stories', sid)));
            stories = rawStories.filter(s => s !== null).map(s => typeof s === 'string' ? JSON.parse(s) : s);
        }
        
        const followers = await redis.smembers(`followers:${userId}`) || [];
        let isFollowing = false;
        if(req.session.user) isFollowing = await redis.sismember(`following:${req.session.user.id}`, userId);

        res.render('profile', { profile, stories: stories.reverse(), followersCount: followers.length, isFollowing });
    } catch (e) { res.redirect('/'); }
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
    if (myId === targetId) return res.json({ ok: false });
    
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

// Export untuk Vercel
module.exports = app;

// Jalankan di lokal
if (process.env.NODE_ENV !== 'production') {
    app.listen(3000, () => console.log('Server Jalan: http://localhost:3000'));
}
