import express from 'express'

const app = express();

app.get('/test', (req, res) => {
    res.send('Test route is working!');
});

export default app;