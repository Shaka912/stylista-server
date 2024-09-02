var jwt = require("jsonwebtoken");

const SECRET_KEY = process.env.SECRET_KEY;

module.exports = async (req, res, next) => {
  const token = req.header("token");
  if (!token) {
    res.status(401).send({ error: "please validate using valid token" });
  }

  try {
    const data = jwt.verify(token, SECRET_KEY);
    req.user = data.user;
    next();
  } catch (error) {
    res.status(401).send({ error: "please validate using valid token" });
  }
};
