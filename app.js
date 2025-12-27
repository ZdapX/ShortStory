
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();

// MASUKKAN DATA DARI SETTINGS > API SUPABASE ANDA DI SINI
const SUPABASE_URL = 'https://xwklgkkjoempqncgfujn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_LG6ji6SFK7NtUpLn17enkg_Edoxjifn';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

app.set('view engine', 'ejs');
app.set('views', path.join(process.cwd(), 'views'));
app.use(express.static(path.join(process.cwd(), 'public')));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use(bodyParser.json());

// 1. BERANDA (MENAMPILKAN SEMUA CERITA)
app.get('/', async (req, res) => {
    const search = req.query.search || '';
    
    let query = supabase.from('stories').select('*').order('createdAt', { ascending: false });

    if (search) {
        query = query.or(`title.ilike.%${search}%,genre.ilike.%${search}%`);
    }

    const { data: stories, error } = await query;

    if (error) {
        console.error(error);
        return res.render('index', { stories: [], search });
    }

    res.render('index', { stories, search });
});

// 2. HALAMAN UPLOAD
app.get('/upload', (req, res) => {
    res.render('upload');
});

// 3. PROSES SIMPAN CERITA
app.post('/upload', async (req, res) => {
    const { title, genre, storyText, authorName, authorImg, coverImg, authorImgFile, coverImgFile } = req.body;

    const { error } = await supabase.from('stories').insert([
        {
            title,
            genre,
            storyText,
            authorName,
            authorImg: authorImgFile || authorImg || `https://ui-avatars.com/api/?name=${authorName}`,
            coverImg: coverImgFile || coverImg || 'https://via.placeholder.com/400x250?text=No+Cover'
        }
    ]);

    if (error) {
        console.error(error);
        return res.status(500).send("Gagal simpan ke Supabase");
    }

    res.redirect('/');
});

// 4. REVIEW CERITA (DETAIL)
app.get('/story/:id', async (req, res) => {
    const { data: story, error } = await supabase
        .from('stories')
        .select('*')
        .eq('id', req.params.id)
        .single();

    if (error || !story) return res.send("Cerita tidak ditemukan");

    res.render('story', { story });
});

module.exports = app;

if (process.env.NODE_ENV !== 'production') {
    app.listen(3000, () => console.log('Server jalan di http://localhost:3000'));
}
