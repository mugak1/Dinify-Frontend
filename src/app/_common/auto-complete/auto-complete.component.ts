import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
    selector: 'app-auto-complete',
    templateUrl: './auto-complete.component.html',
    styleUrl: './auto-complete.component.css',
    standalone: false
})
export class AutoCompleteComponent {
  @Input() countries:any[]|undefined = [
/*     { name: "Afghanistan", code: "AF" },
    { name: "Åland Islands", code: "AX" },
    { name: "Albania", code: "AL" },
    { name: "Algeria", code: "DZ" },
    { name: "American Samoa", code: "AS" },
    { name: "AndorrA", code: "AD" },
    { name: "Angola", code: "AO" },
    { name: "Anguilla", code: "AI" },
    { name: "Antarctica", code: "AQ" },
    { name: "Antigua and Barbuda", code: "AG" },
    { name: "Argentina", code: "AR" },
    { name: "Armenia", code: "AM" },
    { name: "Aruba", code: "AW" },
    { name: "Australia", code: "AU" },
    { name: "Austria", code: "AT" },
    { name: "Azerbaijan", code: "AZ" },
    { name: "Bahamas", code: "BS" },
    { name: "Bahrain", code: "BH" },
    { name: "Bangladesh", code: "BD" },
    { name: "Barbados", code: "BB" },
    { name: "Belarus", code: "BY" },
    { name: "Belgium", code: "BE" },
    { name: "Belize", code: "BZ" },
    { name: "Benin", code: "BJ" },
    { name: "Bermuda", code: "BM" },
    { name: "Bhutan", code: "BT" },
    { name: "Bolivia", code: "BO" },
    { name: "Bosnia and Herzegovina", code: "BA" },
    { name: "Botswana", code: "BW" },
    { name: "Bouvet Island", code: "BV" },
    { name: "Brazil", code: "BR" },
    { name: "British Indian Ocean Territory", code: "IO" },
    { name: "Brunei Darussalam", code: "BN" },
    { name: "Bulgaria", code: "BG" },
    { name: "Burkina Faso", code: "BF" },
    { name: "Burundi", code: "BI" },
    { name: "Cambodia", code: "KH" },
    { name: "Cameroon", code: "CM" },
    { name: "Canada", code: "CA" },
    { name: "Cape Verde", code: "CV" },
    { name: "Cayman Islands", code: "KY" },
    { name: "Central African Republic", code: "CF" },
    { name: "Chad", code: "TD" }, */
  ];
filteredCountries:any[]|undefined=[];
@Input() column:any;
@Input() placeholder=''
  @Output() selected = new EventEmitter();
 
  constructor() {
    this.filteredCountries =this.countries  
    
  }
  
  onkeyUp(event:any){
    const keyword = event.target.value;
    const dropdownEl = document.querySelector("#dropdown");
    dropdownEl?.classList.remove("hidden");
    this.filteredCountries = this.countries?.filter((c) =>
      c[this.column].toLowerCase().includes(keyword.toLowerCase())
    );
  
  //  this.renderOptions(filteredCountries);
}

selectOption(selectedOption:any,id:any) {
  hideDropdown();
  const input:any = document.querySelector("#autocompleteInput");
  input.value = selectedOption;
  this.selected.emit(this.countries?.find(x=>x.id==id))
}


}

document.addEventListener("click", () => {
  hideDropdown();
});

function hideDropdown() {
  const dropdownEl:any = document.querySelector("#dropdown");
  dropdownEl?.classList.add("hidden");
}

/* document.addEventListener("DOMContentLoaded", () => {
  renderOptions(countries);
}); */
