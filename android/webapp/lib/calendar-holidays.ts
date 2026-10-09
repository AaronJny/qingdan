import{CHINESE_HOLIDAY_YEARS,isChineseWorkday}from'../assets/chinese-calendar.ts';
export type HolidayMark={kind:'holiday'|'makeup';label:string;name:string;date:string};
const names:Record<number,string[]>={2025:['元旦','春节','清明节','劳动节','端午节','国庆节/中秋节'],2026:['元旦','春节','清明节','劳动节','端午节','中秋节','国庆节']};
/** Marks official published exceptions only, never infers statutory leave from weekends. */
export function calendarHolidayMark(date:string):HolidayMark|null{if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new RangeError('日期格式无效');const year=Number(date.slice(0,4)),data=CHINESE_HOLIDAY_YEARS[year];if(!data)return null;isChineseWorkday(date);if(data.makeupWorkdays.includes(date))return{kind:'makeup',label:'班',name:'调休补班',date};const index=data.holidayRanges.findIndex(([start,end])=>date>=start&&date<=end);return index<0?null:{kind:'holiday',label:'休',name:names[year]?.[index]||'法定休假',date}}
export function holidayCoverage(dates:string[]){const years=[...new Set(dates.map(date=>Number(date.slice(0,4))))].sort((a,b)=>a-b);return{covered:years.filter(year=>!!CHINESE_HOLIDAY_YEARS[year]),missing:years.filter(year=>!CHINESE_HOLIDAY_YEARS[year])}}
export function holidaySources(year:number){return CHINESE_HOLIDAY_YEARS[year]?.sourceUrls||[]}
