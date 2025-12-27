
const express = require('express');
const Redis = require('ioredis');
const bodyParser = require('body-parser');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = 3000;

// Konfigurasi Database Upstash (Hardcoded sesuai permintaan)
const redis = new Redis('rediss://default:AcQ4AAIncDFlYjI2ZWM2ODhmOGQ0N2YwOTI1Njg5ZDA3ZjRjMDdhMHAxNTAyMzI@growing-firefly-50232.upstash.io:6379');

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// ROUTE: Beranda (Menampilkan Semua Story & Search)
app.get('/', async (req, res) => {
    const search = req.query.search || '';
    const allStories = await redis.hgetall('stories');
    
    // Ubah object stories ke array dan sorting terbaru
    let stories = Object.values(allStories).map(s => JSON.parse(s));

    if (search) {
        stories = stories.filter(s => 
            s.title.toLowerCase().includes(search.toLowerCase()) || 
            s.genre.toLowerCase().includes(search.toLowerCase())
        );
    }

    res.render('index', { stories: stories.reverse(), search });
});

// ROUTE: Halaman Upload
app.get('/upload', (req, res) => {
    res.render('upload');
});

// ROUTE: Proses Upload
app.post('/upload', async (req, res) => {
    const { title, genre, storyText, authorName, authorImg, coverImg } = req.body;
    const id = uuidv4();
    
    const newStory = {
        id,
        title,
        genre,
        storyText,
        authorName,
        authorImg: authorImg || 'https://ui-avatars.com/api/?name=' + authorName,
        coverImg: coverImg || 'https://via.placeholder.com/400x200?text=No+Cover',
        createdAt: new Date().toLocaleString()
    };

    await redis.hset('stories', id, JSON.stringify(newStory));
    res.redirect('/');
});

// ROUTE: Review Story Detail
app.get('/story/:id', async (req, res) => {
    const storyData = await redis.hget('stories', req.params.id);
    if (!storyData) return res.send("Story tidak ditemukan");
    
    const story = JSON.parse(storyData);
    res.render('story', { story });
});

app.listen(port, () => {
    console.log(`Server jalan di http://localhost:${port}`);
});
