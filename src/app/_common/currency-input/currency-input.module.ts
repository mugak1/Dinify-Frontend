import { CommonModule, CurrencyPipe } from "@angular/common";
import { NgModule } from "@angular/core";
import { CurrencyInputComponent } from "./currency-input.component";

@NgModule({
    imports: [CommonModule],
    declarations: [CurrencyInputComponent],
    exports: [CurrencyInputComponent],
    providers: [CurrencyPipe],
  })
  export class CurrencyModule {}