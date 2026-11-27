---- MODULE Grouping ----
VARIABLE s
Init == s = 23
Next == s' = 1
Inv == TRUE \/ FALSE /\ FALSE
====
