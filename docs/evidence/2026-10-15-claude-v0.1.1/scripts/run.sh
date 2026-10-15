#!/bin/zsh
# usage: run.sh <label> <script> [args...]  → raw/watcher/HH-MM-SS_<label>.txt, headed by the command
cd <package>/public/scripts
label=$1; shift; f=../../raw/watcher/$(date +%H-%M-%S)_$label.txt
{ print -r -- "\$ node ${(q)@}"; print "started $(date '+%F %T %Z')"; node "$@" 2>&1; print "ended $(date '+%T')"; } | tee $f
