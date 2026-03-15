import { Component, EventEmitter, input, Input, Output, OnInit } from '@angular/core';

@Component({
  selector: 'app-datePicker',
  templateUrl: './date-picker.component.html',
  styleUrl: './date-picker.component.css'
})
export class DatePickerComponent implements OnInit {MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
];
DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
showDatepicker = false;
@Input() init_date!: string;
@Input() errorMsg='';
datepickerValue!: string;
@Output()SelectedDate= new EventEmitter<any>;
month!: number; // !: mean promis it will not be null, and it will definitely be assigned
year!: number;
no_of_days = [] as number[];
blankdays = [] as number[];
@Input()valid?:boolean=false;

constructor() {}

ngOnInit(): void {
  this.initDate();
  this.getNoOfDays();
}

initDate() {
  
  if(this.init_date){
    const today =new Date(this.init_date);
    this.month=today.getMonth();
    this.year=today.getFullYear();
    this.datepickerValue = new Date(this.year, this.month, today.getDate()).toDateString();
  }else{
    const today = new Date();
  this.month = today.getMonth();
  this.year = today.getFullYear();
  this.datepickerValue = new Date(this.year, this.month, today.getDate()).toDateString();
  }
  
  //this.SelectedDate.emit(this.datepickerValue)
}

isToday(date: any) {
  const today = new Date();
  const d = new Date(this.year, this.month, date);
  return today.toDateString() === d.toDateString() ? true : false;
}

getDateValue(date: any) {
  const selectedDate = new Date(this.year, this.month, date);
  this.datepickerValue = selectedDate.toDateString();
  this.showDatepicker = false;
  this.SelectedDate.emit(`${this.year}-${this.month + 1}-${date}`);
}

getNoOfDays() {
  const daysInMonth = new Date(this.year, this.month + 1, 0).getDate();

  // find where to start calendar day of week
  const dayOfWeek = new Date(this.year, this.month).getDay();
  const blankdaysArray = [];
  for (var i = 1; i <= dayOfWeek; i++) {
    blankdaysArray.push(i);
  }

  const daysArray = [];
  for (var i = 1; i <= daysInMonth; i++) {
    daysArray.push(i);
  }

  this.blankdays = blankdaysArray;
  this.no_of_days = daysArray;
}

trackByIdentity = (index: number, item: any) => item;
}
