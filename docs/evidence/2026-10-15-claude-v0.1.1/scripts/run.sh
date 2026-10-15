#!/bin/zsh
# Runs one of the scripts in this directory with node and writes its output to a log headed by the command.
# usage: run.sh <label> <script> [args...]
# The log goes to $LOG_DIR/HH-MM-SS_<label>.txt; LOG_DIR defaults to ./logs in the current working directory.
set -e
set -o pipefail
[[ $# -ge 2 ]] || { print -u2 "usage: run.sh <label> <script> [args...]"; exit 2; }
scripts=${0:A:h}
log_dir=${LOG_DIR:-$PWD/logs}
mkdir -p "$log_dir"
log_dir=${log_dir:A}
label=$1; shift
f=$log_dir/$(date +%H-%M-%S)_$label.txt
cd "$scripts" || exit 1
{ print -r -- "\$ node ${(q)@}"; print "started $(date '+%F %T %Z')"; node "$@" 2>&1; print "ended $(date '+%T')"; } | tee "$f"
