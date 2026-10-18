'use client';
import{useEffect,useRef,useState}from'react';import{draftStore}from'./client-storage';
/** Temporary input, saved synchronously before navigation or a pending request. */
export function useDraftInput(key:string):[string,(value:string|((current:string)=>string))=>void]{const [value,setValue]=useState(()=>draftStore.getItem(key)||'');const current=useRef(value),edited=useRef(false);useEffect(()=>{if(!edited.current){const saved=draftStore.getItem(key)||'';current.current=saved;setValue(saved)}},[key]);return[value,next=>{edited.current=true;const resolved=typeof next==='function'?next(current.current):next;current.current=resolved;if(resolved)draftStore.setItem(key,resolved);else draftStore.removeItem(key);setValue(resolved)}]}
