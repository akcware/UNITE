module.exports = (req, res, err, page) => {
  if(!err)
    return false;
  
  console.error(err.message);
  req.flash('error', err.message);
  res.redirect(page);
  throw err;
};