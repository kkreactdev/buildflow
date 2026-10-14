import { Schema, model } from 'mongoose';

/** Global named sequences (human-facing ids such as client numbers). Not branch-owned. */
const counterSchema = new Schema({
  key: { type: String, required: true },
  seq: { type: Number, required: true, default: 0 },
});
counterSchema.index({ key: 1 }, { unique: true });

export const Counter = model('Counter', counterSchema);
