
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
app.use(bodyParser.json());

// Session Setup
app.use(session({
    name: 'session',
    keys: ['secretstorykey'],
    maxAge: 24 * 60 * 60 * 1000 // 24 jam
}));

// Middleware Cek Login
const checkAuth = (req, res, next) => {
    if (!req.session.user) return res.redirect('/login');
    next();
};

// Global User variable for EJS
app.use(async (req, res, next) => {
    res.locals.user = req.session.user || null;
    next();
});

// --- AUTH ROUTES ---
app.get('/login', (req, res) => res.render('login', { error: null }));
app.get('/register', (req, res) => res.render('register', { error: null }));

app.post('/register', async (req, res) => {
    const { username, password, name } = req.body;
    const userId = uuidv4();
    const existing = await redis.hget('users_map', username);
    if (existing) return res.render('register', { error: 'Username sudah dipakai' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = { id: userId, username, password: hashedPassword, name, bio: '', profilePic: '' };
    
    await redis.hset('users', { [userId]: JSON.stringify(newUser) });
    await redis.hset('users_map', { [username]: userId });
    res.redirect('/login');
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const userId = await redis.hget('users_map', username);
    if (!userId) return res.render('login', { error: 'User tidak ditemukan' });

    const user = await redis.hget('users', userId);
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) return res.render('login', { error: 'Password salah' });

    req.session.user = { id: user.id, name: user.name, username: user.username };
    res.redirect('/');
});

app.get('/logout', (req, res) => {
    req.session = null;
    res.redirect('/');
});

// --- STORY ROUTES ---
app.get('/', async (req, res) => {
    try {
        const { search, genre } = req.query;
        const allStories = await redis.hgetall('stories') || {};
        let stories = Object.values(allStories).map(s => typeof s === 'string' ? JSON.parse(s) : s);

        if (genre) stories = stories.filter(s => s.genre === genre);
        if (search) stories = stories.filter(s => s.title.toLowerCase().includes(search.toLowerCase()));

        res.render('index', { stories: stories.reverse(), search, currentGenre: genre || '' });
    } catch (err) { res.render('index', { stories: [], search: '', currentGenre: '' }); }
});

app.get('/upload', checkAuth, (req, res) => res.render('upload'));

app.post('/upload', checkAuth, async (req, res) => {
    const { title, genre, storyText, coverImg, coverImgFile } = req.body;
    const id = uuidv4();
    const userFull = await redis.hget('users', req.session.user.id);

    const newStory = {
        id,
        title,
        genre,
        storyText,
        authorId: userFull.id,
        authorName: userFull.name,
        authorImg: userFull.profilePic || `https://ui-avatars.com/api/?name=${userFull.name}`,
        coverImg: coverImgFile || coverImg || 'https://via.placeholder.com/400x250',
        createdAt: new Date().toLocaleDateString('id-ID'),
        likes: [],
        comments: []
    };

    await redis.hset('stories', { [id]: JSON.stringify(newStory) });
    res.redirect('/');
});

app.get('/story/:id', async (req, res) => {
    const story = await redis.hget('stories', req.params.id);
    if (!story) return res.redirect('/');
    res.render('story', { story: typeof story === 'string' ? JSON.parse(story) : story });
});

app.post('/story/:id/like', checkAuth, async (req, res) => {
    const story = JSON.parse(await redis.hget('stories', req.params.id));
    const userId = req.session.user.id;
    if (!story.likes) story.likes = [];
    
    if (story.likes.includes(userId)) {
        story.likes = story.likes.filter(id => id !== userId);
    } else {
        story.likes.push(userId);
    }
    await redis.hset('stories', { [req.params.id]: JSON.stringify(story) });
    res.json({ count: story.likes.length });
});

app.post('/story/:id/comment', checkAuth, async (req, res) => {
    const story = JSON.parse(await redis.hget('stories', req.params.id));
    const newComment = {
        id: uuidv4(),
        userName: req.session.user.name,
        text: req.body.text,
        date: new Date().toLocaleDateString()
    };
    if (!story.comments) story.comments = [];
    story.comments.push(newComment);
    await redis.hset('stories', { [req.params.id]: JSON.stringify(story) });
    res.redirect(`/story/${req.params.id}`);
});

// --- PROFILE ROUTES ---
app.get('/profile/:id', async (req, res) => {
    const targetUser = JSON.parse(await redis.hget('users', req.params.id));
    const allStories = await redis.hgetall('stories') || {};
    const myStories = Object.values(allStories)
        .map(s => JSON.parse(s))
        .filter(s => s.authorId === req.params.id);
    
    // Follow logic
    const followers = await redis.smembers(`followers:${req.params.id}`) || [];
    const following = await redis.smembers(`following:${req.session.user?.id}`) || [];

    res.render('profile', { 
        profile: targetUser, 
        stories: myStories, 
        followersCount: followers.length,
        isFollowing: following.includes(req.params.id)
    });
});

app.get('/settings', checkAuth, async (req, res) => {
    const userFull = await redis.hget('users', req.session.user.id);
    res.render('settings', { userFull });
});

app.post('/settings', checkAuth, async (req, res) => {
    const { name, profilePicFile } = req.body;
    const userFull = JSON.parse(await redis.hget('users', req.session.user.id));
    
    userFull.name = name;
    if (profilePicFile) userFull.profilePic = profilePicFile;
    
    await redis.hset('users', { [userFull.id]: JSON.stringify(userFull) });
    req.session.user.name = name; // Update session
    res.redirect(`/profile/${userFull.id}`);
});

app.post('/follow/:id', checkAuth, async (req, res) => {
    const myId = req.session.user.id;
    const targetId = req.params.id;
    if (myId === targetId) return res.json({ error: "Cant follow self" });

    const isFollowing = await redis.sismember(`following:${myId}`, targetId);
    if (isFollowing) {
        await redis.srem(`following:${myId}`, targetId);
        await redis.srem(`followers:${targetId}`, myId);
    } else {
        await redis.sadd(`following:${myId}`, targetId);
        await redis.sadd(`followers:${targetId}`, myId);
    }
    res.json({ status: 'ok' });
});

module.exports = app;
if (process.env.NODE_ENV !== 'production') app.listen(3000);
