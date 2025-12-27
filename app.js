
const express = require('express');
const { Redis } = require('@upstash/redis');
const bodyParser = require('body-parser');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();

// Konfigurasi Database Upstash (Langsung sesuai permintaan)
const redis = new Redis({
  url: 'https://growing-firefly-50232.upstash.io',
  token: 'AcQ4AAIncDFlYjI2ZWM2ODhmOGQ0N2YwOTI1Njg5ZDA3ZjRjMDdhMHAxNTAyMzI',
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Beranda
app.get('/', async (req, res) => {
    try {
        const search = req.query.search || '';
        const allStories = await redis.hgetall('stories') || {};
        
        let stories = Object.values(allStories).map(s => typeof s === 'string' ? JSON.parse(s) : s);

        if (search) {
            stories = stories.filter(s => 
                s.title.toLowerCase().includes(search.toLowerCase()) || 
                s.genre.toLowerCase().includes(search.toLowerCase())
            );
        }

        res.render('index', { stories: stories.reverse(), search });
    } catch (err) {
        res.status(500).send("Gagal memuat cerita");
    }
});

// Halaman Form Upload
app.get('/upload', (req, res) => {
    res.render('upload');
});

// Proses Simpan Cerita
app.post('/upload', async (req, res) => {
    const { title, genre, storyText, authorName, authorImg, coverImg, authorImgFile, coverImgFile } = req.body;
    const id = uuidv4();
    
    // Logika: Gunakan file jika ada (Base64), jika tidak gunakan URL
    const finalAuthorImg = authorImgFile || authorImg || `https://ui-avatars.com/api/?name=${authorName}`;
    const finalCoverImg = coverImgFile || coverImg || 'https://via.placeholder.com/400x250?text=No+Cover';

    const newStory = {
        id,
        title,
        genre,
        storyText,
        authorName,
        authorImg: finalAuthorImg,
        coverImg: finalCoverImg,
        createdAt: new Date().toLocaleDateString('id-ID', { day:'numeric', month:'long', year:'numeric' })
    };

    await redis.hset('stories', { [id]: JSON.stringify(newStory) });
    res.redirect('/');
});

// Halaman Review Story
app.get('/story/:id', async (req, res) => {
    const storyData = await redis.hget('stories', req.params.id);
    if (!storyData) return res.send("Story tidak ditemukan");
    
    const story = typeof storyData === 'string' ? JSON.parse(storyData) : storyData;
    res.render('story', { story });
});

// Export untuk Vercel
module.exports = app;

// Jalankan jika di lokal
if (process.env.NODE_ENV !== 'production') {
    app.listen(3000, () => console.log('Server running on http://localhost:3000'));
}
