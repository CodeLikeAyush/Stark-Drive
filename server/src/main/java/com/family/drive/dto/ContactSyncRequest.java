package com.family.drive.dto;

import java.util.List;

public class ContactSyncRequest {
    private String deviceContactId;
    private String name;
    private List<String> phoneNumbers;
    private List<String> emails;
    private Long lastUpdated;

    public ContactSyncRequest() {}

    public ContactSyncRequest(String deviceContactId, String name, List<String> phoneNumbers, List<String> emails, Long lastUpdated) {
        this.deviceContactId = deviceContactId;
        this.name = name;
        this.phoneNumbers = phoneNumbers;
        this.emails = emails;
        this.lastUpdated = lastUpdated;
    }

    public String getDeviceContactId() {
        return deviceContactId;
    }

    public void setDeviceContactId(String deviceContactId) {
        this.deviceContactId = deviceContactId;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public List<String> getPhoneNumbers() {
        return phoneNumbers;
    }

    public void setPhoneNumbers(List<String> phoneNumbers) {
        this.phoneNumbers = phoneNumbers;
    }

    public List<String> getEmails() {
        return emails;
    }

    public void setEmails(List<String> emails) {
        this.emails = emails;
    }

    public Long getLastUpdated() {
        return lastUpdated;
    }

    public void setLastUpdated(Long lastUpdated) {
        this.lastUpdated = lastUpdated;
    }
}
