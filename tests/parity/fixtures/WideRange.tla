---- MODULE WideRange ----
EXTENDS Integers
VARIABLE ticket

Init == ticket = -1
Issue == ticket = -1 /\ ticket' \in 0..1000
Close == ticket >= 0 /\ ticket <= 1000 /\ ticket' = ticket + 1001
Next == Issue \/ Close
====
