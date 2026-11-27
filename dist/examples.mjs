export const examples = {
  "HappyPath": "---- MODULE HappyPath ----\nEXTENDS Integers\nVARIABLES stage, seats\n\nInit == stage = \"open\" /\\ seats = 0\n\nReserve == /\\ stage = \"open\"\n           /\\ seats' \\in 1..3\n           /\\ stage' = \"reserved\"\n\nConfirm == /\\ stage = \"reserved\"\n           /\\ seats' = seats\n           /\\ stage' = \"confirmed\"\n\nNext == Reserve \\/ Confirm\nSafety == seats <= 3\n====\n"
};
