const mongoose = require("mongoose");
const bcryptjs = require("bcryptjs");
const jwt = require("jsonwebtoken");

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: [true, "email is required"],
      unique: true,
    },
    password: {
      type: String,
      required: [true, "password is required"],
    },
  },
  {
    timestamps: true,
  }
);

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) {
    return next();
  }

  const salt = await bcryptjs.genSalt();
  this.password = await bcryptjs.hash(this.password, salt);
  next();
});


userSchema.methods.generateToken = function () {
  return jwt.sign({ id: this._id }, "x-auth-token", {
    expiresIn: "3d",
  });
};

userSchema.methods.verifypass = async function (userEnteredPass) {
  console.log("userEnteredPass",userEnteredPass)
  console.log(await bcryptjs.compare(userEnteredPass, this.password))
  return await bcryptjs.compare(userEnteredPass, this.password);
};

const User = mongoose.model("User", userSchema);
module.exports = User;