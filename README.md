Un README per GymOS dovrebbe coprire:

GymOS — Tracker allenamento italiano con progressione scientifica (Israetel/RP)

Metrica volume: hard sets (serie RIR ≤ 3), non kg·reps. Volume load (reps × carico) tenuto solo per trend/PR
Progressione: evaluateSession con regole RIR/reps, deload programmato o anticipato (plateau/RIR inaffidabile), shouldTriggerDeload centralizzata
Autoregolazione intra-sessione: adjustLoadForNextSet modifica carico in base a |diff| dal RIR target
Salvataggio diretto: senza wizard, empty-start con esercizi creati dall'utente
CSV: export/import sezionato (esercizi, sessioni, set, mesocicli, volumi), backup pre-import
Riepilogo giornaliero: per gruppo muscolare con hard sets, condivisione PNG via canvas 1080×N
Persistenza: localStorage, backward compat via initializeMissingStates
