import{localDate}from'./types.ts';
// Instants are stored in UTC; these views already define today in the browser's local zone.
export function instantLocalDate(instant?:string):string{if(!instant)return'';const date=new Date(instant);return Number.isFinite(date.getTime())?localDate(date):''}
