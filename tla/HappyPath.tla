---- MODULE HappyPath ----
EXTENDS Integers
VARIABLES stage, seats

Init == stage = "open" /\ seats = 0

Reserve == /\ stage = "open"
           /\ seats' \in 1..3
           /\ stage' = "reserved"

Confirm == /\ stage = "reserved"
           /\ seats' = seats
           /\ stage' = "confirmed"

Next == Reserve \/ Confirm
Safety == seats <= 3
====
