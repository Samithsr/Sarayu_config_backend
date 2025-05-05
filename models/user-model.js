const mongoose = require("mongoose");
const bcryptjs = require("bcryptjs");
const jwt = require("jsonwebtoken");

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      trim: true,
    },
    password: {
      type: String,
      required: [true, "Password is required"],
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
  return jwt.sign({ _id: this._id, email: this.email }, "x-auth-token", {
    expiresIn: "3d",
  });
};

userSchema.methods.verifypass = async function (userEnteredPass) {
  return await bcryptjs.compare(userEnteredPass, this.password);
};

const User = mongoose.model("User", userSchema);
module.exports = User;