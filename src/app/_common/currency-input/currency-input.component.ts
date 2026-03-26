import { CurrencyPipe } from '@angular/common';
import { Component, HostListener, Input, OnInit, forwardRef } from '@angular/core';
import { NG_VALUE_ACCESSOR, ControlValueAccessor, FormGroup, FormControl, ControlContainer } from '@angular/forms';

@Component({
    selector: 'app-input[type=currency]',
    templateUrl: './currency-input.component.html',
    styleUrls: ['./currency-input.component.css'],
    providers: [
        {
            provide: NG_VALUE_ACCESSOR,
            useExisting: forwardRef(() => CurrencyInputComponent),
            multi: true,
        },
        CurrencyPipe
    ],
    standalone: false
})
export class CurrencyInputComponent implements ControlValueAccessor, OnInit {
  @Input() formControlName!: string;
  @Input() placeholder!:string;
  value: any;
  onChange?: () => any;
  onTouche?: () => any;

  public formGroup?: FormGroup;
  public formControl?: FormControl;

  constructor(
    private controlContainer: ControlContainer,
    private currencyPipe: CurrencyPipe
  ) {}

  ngOnInit() {
    this.setStateInitialization();
  }

  private setStateInitialization(): void {
    this.formGroup = this.controlContainer.control as FormGroup;
    this.formControl = this.formGroup.get(this.formControlName) as FormControl;
  }

  writeValue(value: any): void {
    this.value = value;
  }
  registerOnChange(fn: any): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: any): void {
    this.onTouche = fn;
  }

  @HostListener('input', ['$event'])
  private _onHostListenerInput(event: InputEvent): void {
    const inputElement:any = event.target as HTMLInputElement;
    let value: string | number = inputElement.value;
    if (value) value = +inputElement.value.replace(/\D/g, '');
    this.formControl?.patchValue(value);
    inputElement.value = value
      ? this.currencyPipe.transform(value, '', '', '0.0')
      : '';
  }
}