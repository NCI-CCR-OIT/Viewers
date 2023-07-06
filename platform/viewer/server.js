const express = require('express');
const app = express();
const path = require('path');

// instruct server to use dist folder
app.use(express.static(path.join(__dirname, '')));

// for all requests, send index.html
app.get('*', function(req, res) {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// run the application on port default or 80 port
const port = process.env.PORT || 80;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
